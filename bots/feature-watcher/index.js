const get     = require('lodash/get')
const Discord = require('discord.js')
const octokit = require('@octokit/rest')({
  headers: {
    // To enable using the Github app APIs
    accept: 'application/vnd.github.machine-man-preview+json"'
  }
});

// Set up handlers for process events
process.on('unhandledRejection', function (err, p) {
  console.error('Unhandled Rejection')
  console.error(err)
  console.error(p)
})

process.on('warning', (warning) => {
  console.warn(warning.name);    // Print the warning name
  console.warn(warning.message); // Print the warning message
  console.warn(warning.stack);   // Print the stack trace
});

// bot config
const cfg = require('./config.js');

const discordClient = new Discord.Client()

// Change the token we authenticate with
function authWithGithub() {
  octokit.authenticate({
    type: 'basic',
    username: cfg.github.authUser,
    password: cfg.github.authPAT,
  })
}

// This only needs to happen once as the token doesn't expire and it sets
// the authentication method for subsequent github requests.
authWithGithub()

// Creates the issue based on the info from Discord
async function createIssue(content, shortName, longName, date) {
  // Options for date display
  const dateOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short'
  };

  // Issue content
  const issue = `Suggested by ${longName}, on ${date.toLocaleString('en-US', dateOptions)}:
>${content}`

  // Create the issue
  return octokit.issues.create({
    owner: cfg.github.destinationRepoOwner,
    repo: cfg.github.destinationRepo,
    title: 'Suggestion from ' + shortName,
    body: issue,
    labels: cfg.github.issueLabels,
  })
}

// Wrap in async iife so we can use async/await. Because I'm too lazy to use promises
(async function() {
  // Wait until connected to Discord
  discordClient.on('ready', () => {
    console.log('Ready!');
  });

  discordClient.on('error', (err) => {
    console.log('Received discordClient error')
    console.log(err)
  });

  discordClient.on('messageReactionAdd', async (reaction, actor) => {
    const message = reaction.message
    if (!message) { return }

    const { author, channel, guild } = message
    if (!author || !channel || !guild) { return }

    const emoji = reaction.emoji
    if (!emoji) { return }

    const isChannel = channel.id === cfg.discord.watchChannel
    const isEmoji   = emoji.name === cfg.discord.watchEmoji
    if (!isChannel || !isEmoji) { return }

    const guildActor = guild.member(actor)
    if (!guildActor) { return }

    const adminActor = guildActor.hasPermission(Discord.Permissions.FLAGS.MANAGE_MESSAGES)
    if (!adminActor) { return }

    const count = reaction.count
    // TODO: walk the list of people who have applied this emoji and bail only
    // if another user with MANAGE_MESSAGES is included
    if (count != 1) { return }

    const shortName = author.username
    if (!shortName) { return }

    const { discriminator, id } = author
    const longName = `${shortName}#${discriminator} / ${id}`

    // at this point we know that
    //   the response was in a text channel w/i a guild
    //   the emoji applied was watched
    //   the channel was watched
    //   the actor has MANAGE_MESSAGES
    //   the user that wrote the original message and their short/long form names

    const { cleanContent, createdAt } = message
    const newIssue = await createIssue(cleanContent, shortName, longName, createdAt)
    const link = newIssue.data.html_url
    console.log(`Created new issue ${link}`)

    if (message.channel) {
      message.channel.send(`Submitted suggestion from ${shortName}; <${link}>`)
    }
  })

  discordClient.on('message', processMessage(discordClient))

  // Login with the Discord App token
  discordClient.login(cfg.discord.token);
})()

function processMessage(client) {
  return async function(message) {
    const { cleanContent, member } = message
    // no guild membor found
    if (!member) { return }

    const isOncall = cleanContent === '!oncall'
    const isOffcall = cleanContent === '!offcall'
    // not a command
    if (!isOffcall && !isOncall) { return }

    if (isOncall) {
      member.addRole(cfg.discord.helperRole, 'self-requested')
    }

    if (isOffcall) {
      member.removeRole(cfg.discord.helperRole, 'self-requested')
    }
  }
}
