require('dotenv').config();
const {
  Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder,
  REST, Routes, SlashCommandBuilder
} = require('discord.js');
const { Pool } = require('pg');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages
  ]
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

const SWEAR_WORDS = [
  'arse','arsehead','arsehole','ass','asshole','bastard','bitch','bloody',
  'bollocks','brotherfucker','bugger','bullshit','child-fucker','cock',
  'cocksucker','crap','cunt','dammit','damn','damned','dick','dick-head',
  'dickhead','dumb-ass','dumbass','dyke','fag','faggot','father-fucker',
  'fatherfucker','fuck','fucked','fucker','fucking','goddammit','goddamn',
  'goddamned','goddamnit','godsdamn','hell','horseshit','jack-ass','jackass',
  'kike','mother-fucker','motherfucker','nigga','niggas','nigger','niggers',
  'nigra','pigfucker','piss','prick','pussy','shit','shite','sisterfuck',
  'sisterfucker','slut','spastic','tranny','twat','wanker'
];

function containsSwear(content) {
  const normalized = content.toLowerCase()
    .replace(/3/g,'e').replace(/0/g,'o').replace(/1/g,'i')
    .replace(/@/g,'a').replace(/\$/g,'s').replace(/\+/g,'t').replace(/!/g,'i');
  return normalized.split(/\s+/).some(w => SWEAR_WORDS.includes(w.replace(/[^a-z-]/g,'')));
}

async function setupDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS verified_users (
    discord_id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, grade TEXT, display_name TEXT
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS swear_blocks (
    discord_id TEXT PRIMARY KEY, expires_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS muted_users (
    discord_id TEXT PRIMARY KEY, expires_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS banned_users (
    discord_id TEXT PRIMARY KEY, expires_at TIMESTAMPTZ, permanent BOOLEAN DEFAULT FALSE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS pending_verifications (
    discord_id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, grade TEXT, screenshot_url TEXT
  )`);
  console.log('✅ Database ready');
}

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID;
const GRADE_5_ROLE_ID = process.env.GRADE_5_ROLE_ID;
const GRADE_6_ROLE_ID = process.env.GRADE_6_ROLE_ID;
const GRADE_7_ROLE_ID = process.env.GRADE_7_ROLE_ID;
const GRADE_8_ROLE_ID = process.env.GRADE_8_ROLE_ID;
const OWNER_ID = process.env.OWNER_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const APPROVER_ID = process.env.APPROVER_ID;
const CONFESSIONS_CHANNEL_ID = process.env.CONFESSIONS_CHANNEL_ID;

function getRoleId(grade) {
  if (grade === '5') return GRADE_5_ROLE_ID;
  if (grade === '6') return GRADE_6_ROLE_ID;
  if (grade === '7') return GRADE_7_ROLE_ID;
  if (grade === '8') return GRADE_8_ROLE_ID;
}

function isAdmin(interaction) {
  return interaction.user.id === OWNER_ID || interaction.member.roles.cache.has(ADMIN_ROLE_ID);
}

function isVerified(interaction, dbResult) {
  return dbResult || interaction.member.roles.cache.has(ADMIN_ROLE_ID) || interaction.user.id === OWNER_ID;
}

// Register all slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('whois')
    .setDescription('See someone\'s title and grade')
    .addUserOption(o => o.setName('user').setDescription('Who do you want to look up?').setRequired(false)),

  new SlashCommandBuilder()
    .setName('confess')
    .setDescription('Send an anonymous love confession')
    .addUserOption(o => o.setName('user').setDescription('Who is the confession for?').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Your confession message').setRequired(true)),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute a user for a set number of minutes')
    .addUserOption(o => o.setName('user').setDescription('Who to mute').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('How many minutes').setRequired(true)),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Unmute a user')
    .addUserOption(o => o.setName('user').setDescription('Who to unmute').setRequired(true)),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set slowmode in this channel (0 to turn off)')
    .addIntegerOption(o => o.setName('seconds').setDescription('Seconds between messages').setRequired(true)),

  new SlashCommandBuilder()
    .setName('swearblock')
    .setDescription('Block a user from swearing for a number of days')
    .addUserOption(o => o.setName('user').setDescription('Who to swear block').setRequired(true))
    .addIntegerOption(o => o.setName('days').setDescription('How many days').setRequired(true)),

  new SlashCommandBuilder()
    .setName('swearunblock')
    .setDescription('Remove a swear block from a user')
    .addUserOption(o => o.setName('user').setDescription('Who to unblock').setRequired(true)),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user for a number of days')
    .addUserOption(o => o.setName('user').setDescription('Who to ban').setRequired(true))
    .addIntegerOption(o => o.setName('days').setDescription('How many days').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for ban').setRequired(false)),

  new SlashCommandBuilder()
    .setName('permaban')
    .setDescription('Permanently ban a user')
    .addUserOption(o => o.setName('user').setDescription('Who to permaban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for ban').setRequired(false)),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by their ID')
    .addStringOption(o => o.setName('userid').setDescription('The user\'s Discord ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('lookup')
    .setDescription('Look up someone\'s full name (sent to your DMs privately)')
    .addUserOption(o => o.setName('user').setDescription('Who to look up').setRequired(true)),

].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('Error registering slash commands:', err);
  }
})();

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await setupDatabase();
  await postVerifyMessage();

  setInterval(async () => {
    try {
      const mutes = await pool.query('SELECT * FROM muted_users WHERE expires_at < NOW()');
      for (const row of mutes.rows) await pool.query('DELETE FROM muted_users WHERE discord_id = $1', [row.discord_id]);
      const bans = await pool.query('SELECT * FROM banned_users WHERE permanent = FALSE AND expires_at < NOW()');
      for (const row of bans.rows) {
        await pool.query('DELETE FROM banned_users WHERE discord_id = $1', [row.discord_id]);
        for (const [, guild] of client.guilds.cache) {
          try { await guild.members.unban(row.discord_id, 'Temp ban expired'); } catch (e) {}
        }
      }
    } catch (err) { console.error('Error checking mutes/bans:', err); }
  }, 60000);
});

async function postVerifyMessage() {
  const channel = await client.channels.fetch(VERIFY_CHANNEL_ID);
  if (!channel) return;
  const messages = await channel.messages.fetch({ limit: 10 });
  if (messages.some(m => m.author.id === client.user.id)) return;

  const embed = new EmbedBuilder()
    .setTitle('✅ Server Verification')
    .setDescription('Welcome! To gain access to the server please verify below.\n\n**Step 1:** Choose your grade\n**Step 2:** Enter your full name\n**Step 3:** Upload a screenshot of your Infinite Campus schedule')
    .setColor(0x5865F2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('grade_5').setLabel('5th Grade').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('grade_6').setLabel('6th Grade').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('grade_7').setLabel('7th Grade').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('grade_8').setLabel('8th Grade').setStyle(ButtonStyle.Success)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

client.on('guildMemberRemove', async (member) => {
  try {
    await pool.query('DELETE FROM verified_users WHERE discord_id = $1', [member.id]);
    await pool.query('DELETE FROM swear_blocks WHERE discord_id = $1', [member.id]);
    await pool.query('DELETE FROM muted_users WHERE discord_id = $1', [member.id]);
    await pool.query('DELETE FROM pending_verifications WHERE discord_id = $1', [member.id]);
  } catch (err) { console.error('Error removing user:', err); }
});

// Message listener for mute/swear checking and screenshot upload
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Screenshot upload in verify channel
  if (message.channelId === VERIFY_CHANNEL_ID && message.attachments.size > 0) {
    const pending = await pool.query('SELECT * FROM pending_verifications WHERE discord_id = $1', [message.author.id]);
    if (!pending.rows[0]) return;

    const { first_name, last_name, grade } = pending.rows[0];
    const attachment = message.attachments.first();
    await pool.query('UPDATE pending_verifications SET screenshot_url = $1 WHERE discord_id = $2', [attachment.url, message.author.id]);

    try {
      const approver = await client.users.fetch(APPROVER_ID);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_${message.author.id}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`decline_${message.author.id}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger)
      );
      await approver.send(`📋 **New Verification Request**\n👤 User: ${message.author.tag} (<@${message.author.id}>)\n📝 Name: **${first_name} ${last_name}**\n🎓 Grade: **${grade}th Grade**\n🖼️ Schedule screenshot below:`);
      await approver.send({ files: [{ attachment: attachment.url, name: attachment.name }], components: [row] });
    } catch (err) { console.error('Could not DM approver:', err); }

    await message.delete();
    const sent = await message.channel.send(`<@${message.author.id}> Your verification request has been submitted! Please wait for approval.`);
    setTimeout(() => sent.delete().catch(() => {}), 10000);
    return;
  }

  // Check if muted
  const muteResult = await pool.query('SELECT * FROM muted_users WHERE discord_id = $1 AND expires_at > NOW()', [message.author.id]);
  if (muteResult.rows.length > 0) {
    await message.delete();
    const minsLeft = Math.ceil((new Date(muteResult.rows[0].expires_at) - new Date()) / (1000 * 60));
    await message.channel.send(`🔇 <@${message.author.id}> You are muted for **${minsLeft}** more minute(s).`);
    return;
  }

  // Check swear block
  const blockResult = await pool.query('SELECT * FROM swear_blocks WHERE discord_id = $1 AND expires_at > NOW()', [message.author.id]);
  if (blockResult.rows.length > 0 && containsSwear(message.content)) {
    await message.delete();
    const words = message.content.split(/\s+/);
    const normalizedWords = message.content.toLowerCase()
      .replace(/3/g,'e').replace(/0/g,'o').replace(/1/g,'i')
      .replace(/@/g,'a').replace(/\$/g,'s').replace(/\+/g,'t').replace(/!/g,'i')
      .split(/\s+/);
    const censored = words.map((w, i) => {
      const cleaned = normalizedWords[i].replace(/[^a-z-]/g,'');
      return SWEAR_WORDS.includes(cleaned) ? '*'.repeat(Math.floor(Math.random() * 10) + 1) : w;
    });
    await message.channel.send(`**${message.author.username}:** ${censored.join(' ')}`);
  }
});

// All slash commands and button interactions
client.on('interactionCreate', async (interaction) => {

  // /whois
  if (interaction.isChatInputCommand() && interaction.commandName === 'whois') {
    const mentioned = interaction.options.getMember('user') || interaction.member;
    const result = await pool.query('SELECT * FROM verified_users WHERE discord_id = $1', [mentioned.id]);
    const user = result.rows[0];
    if (!user) return interaction.reply({ content: '❌ That user has not verified yet.', ephemeral: true });
    const embed = new EmbedBuilder()
      .setTitle(`🏷️ ${user.display_name}`)
      .addFields(
        { name: 'Grade', value: `${user.grade}th Grade`, inline: true },
        { name: 'Title', value: user.display_name, inline: true }
      )
      .setColor(user.grade === '7' ? 0x5865F2 : 0x57F287);
    return interaction.reply({ embeds: [embed] });
  }

  // /confess
  if (interaction.isChatInputCommand() && interaction.commandName === 'confess') {
    const senderResult = await pool.query('SELECT * FROM verified_users WHERE discord_id = $1', [interaction.user.id]);
    if (!isVerified(interaction, senderResult.rows[0])) {
      return interaction.reply({ content: '❌ You need to be verified to send a confession!', ephemeral: true });
    }
    const mentioned = interaction.options.getMember('user');
    const confessionText = interaction.options.getString('message');
    const receiverResult = await pool.query('SELECT * FROM verified_users WHERE discord_id = $1', [mentioned.id]);
    const receiverName = receiverResult.rows[0] ? receiverResult.rows[0].display_name : (mentioned.nickname || mentioned.user.username);
    await interaction.reply({ content: '💌 Your confession has been sent anonymously!', ephemeral: true });
    const confessionsChannel = await client.channels.fetch(CONFESSIONS_CHANNEL_ID);
    if (!confessionsChannel) return;
    const embed = new EmbedBuilder()
      .setTitle('💌 A Confession')
      .setDescription(`This message is for **${receiverName}**\n\n"${confessionText}"\n\n— Anonymous`)
      .setColor(0xFF69B4);
    return confessionsChannel.send({ embeds: [embed] });
  }

  // /mute
  if (interaction.isChatInputCommand() && interaction.commandName === 'mute') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    const mentioned = interaction.options.getMember('user');
    const minutes = interaction.options.getInteger('minutes');
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + minutes);
    await pool.query(`INSERT INTO muted_users (discord_id, expires_at) VALUES ($1, $2) ON CONFLICT (discord_id) DO UPDATE SET expires_at = $2`, [mentioned.id, expiresAt]);
    return interaction.reply({ content: `🔇 <@${mentioned.id}> has been muted for **${minutes}** minute(s).` });
  }

  // /unmute
  if (interaction.isChatInputCommand() && interaction.commandName === 'unmute') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    const mentioned = interaction.options.getMember('user');
    await pool.query('DELETE FROM muted_users WHERE discord_id = $1', [mentioned.id]);
    return interaction.reply({ content: `🔊 <@${mentioned.id}> has been unmuted!` });
  }

  // /slowmode
  if (interaction.isChatInputCommand() && interaction.commandName === 'slowmode') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    const seconds = interaction.options.getInteger('seconds');
    await interaction.channel.setRateLimitPerUser(seconds);
    return interaction.reply({ content: seconds === 0 ? '✅ Slowmode turned **off**.' : `✅ Slowmode set to **${seconds}** second(s).` });
  }

  // /swearblock
  if (interaction.isChatInputCommand() && interaction.commandName === 'swearblock') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    const mentioned = interaction.options.getMember('user');
    const days = interaction.options.getInteger('days');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    await pool.query(`INSERT INTO swear_blocks (discord_id, expires_at) VALUES ($1, $2) ON CONFLICT (discord_id) DO UPDATE SET expires_at = $2`, [mentioned.id, expiresAt]);
    return interaction.reply({ content: `✅ <@${mentioned.id}> has been swear blocked for **${days}** day(s).` });
  }

  // /swearunblock
  if (interaction.isChatInputCommand() && interaction.commandName === 'swearunblock') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    const mentioned = interaction.options.getMember('user');
    await pool.query('DELETE FROM swear_blocks WHERE discord_id = $1', [mentioned.id]);
    return interaction.reply({ content: `✅ <@${mentioned.id}> has been swear unblocked!` });
  }

  // /ban
  if (interaction.isChatInputCommand() && interaction.commandName === 'ban') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    const mentioned = interaction.options.getMember('user');
    const days = interaction.options.getInteger('days');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    await pool.query(`INSERT INTO banned_users (discord_id, expires_at, permanent) VALUES ($1, $2, FALSE) ON CONFLICT (discord_id) DO UPDATE SET expires_at = $2, permanent = FALSE`, [mentioned.id, expiresAt]);
    try { await mentioned.send(`🔨 You have been banned for **${days}** day(s).\n📋 Reason: **${reason}**`); } catch (e) {}
    await mentioned.ban({ reason: `${reason} (${days} day temp ban)` });
    return interaction.reply({ content: `🔨 <@${mentioned.id}> has been banned for **${days}** day(s).\n📋 Reason: **${reason}**` });
  }

  // /permaban
  if (interaction.isChatInputCommand() && interaction.commandName === 'permaban') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    const mentioned = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    await pool.query(`INSERT INTO banned_users (discord_id, expires_at, permanent) VALUES ($1, NULL, TRUE) ON CONFLICT (discord_id) DO UPDATE SET expires_at = NULL, permanent = TRUE`, [mentioned.id]);
    try { await mentioned.send(`🔨 You have been **permanently banned**.\n📋 Reason: **${reason}**`); } catch (e) {}
    await mentioned.ban({ reason: `${reason} (permanent ban)` });
    return interaction.reply({ content: `🔨 <@${mentioned.id}> has been **permanently banned**.\n📋 Reason: **${reason}**` });
  }

  // /unban
  if (interaction.isChatInputCommand() && interaction.commandName === 'unban') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    const userId = interaction.options.getString('userid');
    await pool.query('DELETE FROM banned_users WHERE discord_id = $1', [userId]);
    try {
      await interaction.guild.members.unban(userId);
      return interaction.reply({ content: `✅ User **${userId}** has been unbanned!` });
    } catch (err) {
      return interaction.reply({ content: '❌ Could not unban. Make sure the ID is correct!', ephemeral: true });
    }
  }

  // /lookup
  if (interaction.isChatInputCommand() && interaction.commandName === 'lookup') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    const mentioned = interaction.options.getMember('user');
    const result = await pool.query('SELECT * FROM verified_users WHERE discord_id = $1', [mentioned.id]);
    const user = result.rows[0];
    if (!user) return interaction.reply({ content: '❌ That user has not verified yet.', ephemeral: true });
    try {
      await interaction.user.send(`🔒 Full name: **${user.first_name} ${user.last_name}** | Grade: **${user.grade}th**`);
      return interaction.reply({ content: '✅ Sent to your DMs!', ephemeral: true });
    } catch (err) {
      return interaction.reply({ content: '❌ Could not send you a DM!', ephemeral: true });
    }
  }

  // Grade buttons
  if (interaction.isButton() && ['grade_5','grade_6','grade_7','grade_8'].includes(interaction.customId)) {
    const grade = interaction.customId.split('_')[1];
    const existing = await pool.query('SELECT * FROM verified_users WHERE discord_id = $1', [interaction.user.id]);
    if (existing.rows.length > 0) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_reverify_${grade}`).setLabel('Yes, update my info').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_reverify').setLabel('No, cancel').setStyle(ButtonStyle.Danger)
      );
      return interaction.reply({ content: `⚠️ You are already verified as **${existing.rows[0].display_name}**. Do you want to update your info?`, components: [row], ephemeral: true });
    }
    const pending = await pool.query('SELECT * FROM pending_verifications WHERE discord_id = $1', [interaction.user.id]);
    if (pending.rows.length > 0) return interaction.reply({ content: '⏳ Your verification is already pending! Please wait.', ephemeral: true });
    return showNameModal(interaction, grade);
  }

  // Confirm re-verify
  if (interaction.isButton() && interaction.customId.startsWith('confirm_reverify_')) {
    return showNameModal(interaction, interaction.customId.split('_')[2]);
  }

  // Cancel re-verify
  if (interaction.isButton() && interaction.customId === 'cancel_reverify') {
    return interaction.reply({ content: '✅ Verification cancelled.', ephemeral: true });
  }

  // Approve verification
  if (interaction.isButton() && interaction.customId.startsWith('approve_')) {
    const userId = interaction.customId.split('_')[1];
    const pending = await pool.query('SELECT * FROM pending_verifications WHERE discord_id = $1', [userId]);
    if (!pending.rows[0]) return interaction.reply({ content: '❌ Verification no longer exists.', ephemeral: true });
    const { first_name, last_name, grade } = pending.rows[0];
    const displayName = `${first_name} ${last_name[0].toUpperCase()}.`;
    await pool.query(`INSERT INTO verified_users (discord_id, first_name, last_name, grade, display_name) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (discord_id) DO UPDATE SET first_name=$2, last_name=$3, grade=$4, display_name=$5`, [userId, first_name, last_name, grade, displayName]);
    await pool.query('DELETE FROM pending_verifications WHERE discord_id = $1', [userId]);
    try {
      for (const [, guild] of client.guilds.cache) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          await member.roles.add(getRoleId(grade)).catch(() => {});
          await member.setNickname(displayName).catch(() => {});
        }
      }
    } catch (err) { console.error('Could not set role/nickname:', err); }
    try { const user = await client.users.fetch(userId); await user.send(`✅ Your verification has been **approved**!\n🏷️ Your title is: **${displayName}**`); } catch (e) {}
    return interaction.update({ content: `✅ Approved **${displayName}** (Grade ${grade})`, components: [] });
  }

  // Decline verification
  if (interaction.isButton() && interaction.customId.startsWith('decline_')) {
    const userId = interaction.customId.split('_')[1];
    await pool.query('DELETE FROM pending_verifications WHERE discord_id = $1', [userId]);
    try { const user = await client.users.fetch(userId); await user.send(`❌ Your verification was **declined**. Please try again with a clear screenshot of your Infinite Campus schedule.`); } catch (e) {}
    return interaction.update({ content: `❌ Declined verification for user ${userId}`, components: [] });
  }

  // Name modal submission
  if (interaction.isModalSubmit() && interaction.customId.startsWith('name_modal_')) {
    const grade = interaction.customId.split('_')[2];
    const fullName = interaction.fields.getTextInputValue('full_name').trim();
    const parts = fullName.split(' ');
    if (parts.length < 2) return interaction.reply({ content: '❌ Please enter both first and last name (e.g. `John Smith`)', ephemeral: true });
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    await pool.query(`INSERT INTO pending_verifications (discord_id, first_name, last_name, grade) VALUES ($1, $2, $3, $4) ON CONFLICT (discord_id) DO UPDATE SET first_name=$2, last_name=$3, grade=$4`, [interaction.user.id, firstName, lastName, grade]);
    return interaction.reply({ content: `✅ Name saved! Now upload a **screenshot of your Infinite Campus schedule** in the verify channel.\n\nGo to Infinite Campus → Click **Schedule** → Take a screenshot and send it in <#${VERIFY_CHANNEL_ID}>.`, ephemeral: true });
  }
});

async function showNameModal(interaction, grade) {
  const modal = new ModalBuilder().setCustomId(`name_modal_${grade}`).setTitle('Enter Your Full Name');
  const nameInput = new TextInputBuilder().setCustomId('full_name').setLabel('Your Full Name (e.g. John Smith)').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(3).setMaxLength(50).setPlaceholder('First Last');
  modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
  return interaction.showModal(modal);
}

client.login(TOKEN);
