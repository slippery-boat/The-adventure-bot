require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
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

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Full swear word list
const SWEAR_WORDS = [
  'arse', 'arsehead', 'arsehole', 'ass', 'asshole', 'bastard', 'bitch',
  'bloody', 'bollocks', 'brotherfucker', 'bugger', 'bullshit', 'child-fucker',
  'cock', 'cocksucker', 'crap', 'cunt', 'dammit', 'damn', 'damned', 'dick',
  'dick-head', 'dickhead', 'dumb-ass', 'dumbass', 'dyke', 'fag', 'faggot',
  'father-fucker', 'fatherfucker', 'fuck', 'fucked', 'fucker', 'fucking',
  'goddammit', 'goddamn', 'goddamned', 'goddamnit', 'godsdamn', 'hell',
  'horseshit', 'jack-ass', 'jackass', 'kike', 'mother-fucker', 'motherfucker',
  'nigga', 'niggas', 'nigger', 'niggers', 'nigra', 'pigfucker', 'piss',
  'prick', 'pussy', 'shit', 'shite', 'sisterfuck', 'sisterfucker', 'slut',
  'spastic', 'tranny', 'twat', 'wanker'
];

// Check if a message contains a swear word including variations
function containsSwear(content) {
  const normalized = content.toLowerCase()
    .replace(/3/g, 'e').replace(/0/g, 'o').replace(/1/g, 'i')
    .replace(/@/g, 'a').replace(/\$/g, 's').replace(/\+/g, 't').replace(/!/g, 'i');
  const words = normalized.split(/\s+/);
  return words.some(word => SWEAR_WORDS.includes(word.replace(/[^a-z-]/g, '')));
}

// Setup database tables
async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS verified_users (
      discord_id TEXT PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      grade TEXT,
      display_name TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS swear_blocks (
      discord_id TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS muted_users (
      discord_id TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS banned_users (
      discord_id TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ,
      permanent BOOLEAN DEFAULT FALSE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_verifications (
      discord_id TEXT PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      grade TEXT,
      screenshot_url TEXT
    )
  `);
  console.log('✅ Database ready');
}

const TOKEN = process.env.TOKEN;
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID;
const GRADE_5_ROLE_ID = process.env.GRADE_5_ROLE_ID;
const GRADE_6_ROLE_ID = process.env.GRADE_6_ROLE_ID;
const GRADE_7_ROLE_ID = process.env.GRADE_7_ROLE_ID;
const GRADE_8_ROLE_ID = process.env.GRADE_8_ROLE_ID;
const OWNER_ID = process.env.OWNER_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const APPROVER_ID = process.env.APPROVER_ID;
const CONFESSIONS_CHANNEL_ID = process.env.CONFESSIONS_CHANNEL_ID;

// Get role ID by grade
function getRoleId(grade) {
  if (grade === '5') return GRADE_5_ROLE_ID;
  if (grade === '6') return GRADE_6_ROLE_ID;
  if (grade === '7') return GRADE_7_ROLE_ID;
  if (grade === '8') return GRADE_8_ROLE_ID;
}

// Check if a user is the owner or has the admin role
function isAdmin(message) {
  return message.author.id === OWNER_ID || message.member.roles.cache.has(ADMIN_ROLE_ID);
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await setupDatabase();
  await postVerifyMessage();

  // Check for expired mutes and bans every minute
  setInterval(async () => {
    try {
      const mutes = await pool.query('SELECT * FROM muted_users WHERE expires_at < NOW()');
      for (const row of mutes.rows) {
        await pool.query('DELETE FROM muted_users WHERE discord_id = $1', [row.discord_id]);
      }
      const bans = await pool.query('SELECT * FROM banned_users WHERE permanent = FALSE AND expires_at < NOW()');
      for (const row of bans.rows) {
        await pool.query('DELETE FROM banned_users WHERE discord_id = $1', [row.discord_id]);
        for (const [, guild] of client.guilds.cache) {
          try { await guild.members.unban(row.discord_id, 'Temp ban expired'); } catch (e) {}
        }
      }
    } catch (err) {
      console.error('Error checking mutes/bans:', err);
    }
  }, 60000);
});

async function postVerifyMessage() {
  const channel = await client.channels.fetch(VERIFY_CHANNEL_ID);
  if (!channel) return;
  const messages = await channel.messages.fetch({ limit: 10 });
  const alreadyPosted = messages.some(m => m.author.id === client.user.id);
  if (alreadyPosted) return;

  const embed = new EmbedBuilder()
    .setTitle('✅ Server Verification')
    .setDescription('Welcome! To gain access to the server please verify below.\n\n**Step 1:** Choose your grade\n**Step 2:** Enter your full name\n**Step 3:** Upload a screenshot of your Infinite Campus schedule')
    .setColor(0x5865F2);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('grade_5').setLabel('5th Grade').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('grade_6').setLabel('6th Grade').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('grade_7').setLabel('7th Grade').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('grade_8').setLabel('8th Grade').setStyle(ButtonStyle.Success)
  );

  await channel.send({ embeds: [embed], components: [row1] });
}

// Auto-unverify when someone leaves the server
client.on('guildMemberRemove', async (member) => {
  try {
    await pool.query('DELETE FROM verified_users WHERE discord_id = $1', [member.id]);
    await pool.query('DELETE FROM swear_blocks WHERE discord_id = $1', [member.id]);
    await pool.query('DELETE FROM muted_users WHERE discord_id = $1', [member.id]);
    await pool.query('DELETE FROM pending_verifications WHERE discord_id = $1', [member.id]);
    console.log(`🗑️ Removed ${member.user.tag} from database (left server)`);
  } catch (err) {
    console.error('Error removing user from database:', err);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Check if user is muted
  const muteResult = await pool.query(
    'SELECT * FROM muted_users WHERE discord_id = $1 AND expires_at > NOW()',
    [message.author.id]
  );
  if (muteResult.rows.length > 0) {
    await message.delete();
    const expiresAt = new Date(muteResult.rows[0].expires_at);
    const minsLeft = Math.ceil((expiresAt - new Date()) / (1000 * 60));
    await message.channel.send(`🔇 <@${message.author.id}> You are muted for **${minsLeft}** more minute(s).`);
    return;
  }

  // Check if user is swear blocked
  const blockResult = await pool.query(
    'SELECT * FROM swear_blocks WHERE discord_id = $1 AND expires_at > NOW()',
    [message.author.id]
  );
  if (blockResult.rows.length > 0) {
    if (containsSwear(message.content)) {
      await message.delete();
      const words = message.content.split(/\s+/);
      const normalizedWords = message.content.toLowerCase()
        .replace(/3/g, 'e').replace(/0/g, 'o').replace(/1/g, 'i')
        .replace(/@/g, 'a').replace(/\$/g, 's').replace(/\+/g, 't').replace(/!/g, 'i')
        .split(/\s+/);
      const censoredWords = words.map((word, i) => {
        const cleaned = normalizedWords[i].replace(/[^a-z-]/g, '');
        if (SWEAR_WORDS.includes(cleaned)) {
          return '*'.repeat(Math.floor(Math.random() * 10) + 1);
        }
        return word;
      });
      await message.channel.send(`**${message.author.username}:** ${censoredWords.join(' ')}`);
      return;
    }
  }

  // Public — anyone can see titles
  if (message.content.startsWith('!whois')) {
    const mentioned = message.mentions.members.first();
    const targetId = mentioned ? mentioned.id : message.author.id;
    const result = await pool.query('SELECT * FROM verified_users WHERE discord_id = $1', [targetId]);
    const user = result.rows[0];
    if (!user) return message.reply('❌ That user has not verified yet.');
    const embed = new EmbedBuilder()
      .setTitle(`🏷️ ${user.display_name}`)
      .addFields(
        { name: 'Grade', value: `${user.grade}th Grade`, inline: true },
        { name: 'Title', value: user.display_name, inline: true }
      )
      .setColor(user.grade === '7' ? 0x5865F2 : 0x57F287);
    message.reply({ embeds: [embed] });
  }

  // Confessions — verified members only
  if (message.content.startsWith('!confess')) {
    const mentioned = message.mentions.members.first();
    if (!mentioned) return message.reply('❌ Mention someone! Example: `!confess @John you are really cool`');

    // Check if sender is verified
    const senderResult = await pool.query('SELECT * FROM verified_users WHERE discord_id = $1', [message.author.id]);
    if (!senderResult.rows[0]) {
      return message.reply('❌ You need to be verified to send a confession!');
    }

    // Check if receiver is verified
    const receiverResult = await pool.query('SELECT * FROM verified_users WHERE discord_id = $1', [mentioned.id]);
    if (!receiverResult.rows[0]) {
      return message.reply('❌ That person is not verified!');
    }

    const args = message.content.split(' ');
    const confessionText = args.slice(2).join(' ');
    if (!confessionText) return message.reply('❌ Please include a message! Example: `!confess @John you are really cool`');

    // Delete original message so nobody sees who sent it
    await message.delete();

    // Post confession anonymously
    const confessionsChannel = await client.channels.fetch(CONFESSIONS_CHANNEL_ID);
    if (!confessionsChannel) return;

    const embed = new EmbedBuilder()
      .setTitle('💌 A Confession')
      .setDescription(`This message is for **${receiverResult.rows[0].display_name}**\n\n"${confessionText}"\n\n— Anonymous`)
      .setColor(0xFF69B4);

    await confessionsChannel.send({ embeds: [embed] });
  }

  // Admin only — mute a user
  if (message.content.startsWith('!mute')) {
    if (!isAdmin(message)) return message.reply('❌ You do not have permission to use this command.');
    const mentioned = message.mentions.members.first();
    if (!mentioned) return message.reply('❌ Mention someone! Example: `!mute @John 10`');
    const args = message.content.split(' ');
    const minutes = parseInt(args[args.length - 1]);
    if (isNaN(minutes) || minutes < 1) return message.reply('❌ Please provide minutes! Example: `!mute @John 10`');
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + minutes);
    await pool.query(`INSERT INTO muted_users (discord_id, expires_at) VALUES ($1, $2) ON CONFLICT (discord_id) DO UPDATE SET expires_at = $2`, [mentioned.id, expiresAt]);
    message.reply(`🔇 <@${mentioned.id}> has been muted for **${minutes}** minute(s).`);
  }

  // Admin only — unmute
  if (message.content.startsWith('!unmute')) {
    if (!isAdmin(message)) return message.reply('❌ You do not have permission to use this command.');
    const mentioned = message.mentions.members.first();
    if (!mentioned) return message.reply('❌ Mention someone! Example: `!unmute @John`');
    await pool.query('DELETE FROM muted_users WHERE discord_id = $1', [mentioned.id]);
    message.reply(`🔊 <@${mentioned.id}> has been unmuted!`);
  }

  // Admin only — slowmode
  if (message.content.startsWith('!slowmode')) {
    if (!isAdmin(message)) return message.reply('❌ You do not have permission to use this command.');
    const args = message.content.split(' ');
    const seconds = parseInt(args[1]);
    if (isNaN(seconds) || seconds < 0) return message.reply('❌ Example: `!slowmode 10` or `!slowmode 0` to turn off');
    await message.channel.setRateLimitPerUser(seconds);
    message.reply(seconds === 0 ? '✅ Slowmode turned **off**.' : `✅ Slowmode set to **${seconds}** second(s).`);
  }

  // Admin only — swearblock
  if (message.content.startsWith('!swearblock')) {
    if (!isAdmin(message)) return message.reply('❌ You do not have permission to use this command.');
    const mentioned = message.mentions.members.first();
    if (!mentioned) return message.reply('❌ Example: `!swearblock @John 7`');
    const args = message.content.split(' ');
    const days = parseInt(args[args.length - 1]);
    if (isNaN(days) || days < 1) return message.reply('❌ Example: `!swearblock @John 7`');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    await pool.query(`INSERT INTO swear_blocks (discord_id, expires_at) VALUES ($1, $2) ON CONFLICT (discord_id) DO UPDATE SET expires_at = $2`, [mentioned.id, expiresAt]);
    message.reply(`✅ <@${mentioned.id}> has been swear blocked for **${days}** day(s).`);
  }

  // Admin only — swearunblock
  if (message.content.startsWith('!swearunblock')) {
    if (!isAdmin(message)) return message.reply('❌ You do not have permission to use this command.');
    const mentioned = message.mentions.members.first();
    if (!mentioned) return message.reply('❌ Example: `!swearunblock @John`');
    await pool.query('DELETE FROM swear_blocks WHERE discord_id = $1', [mentioned.id]);
    message.reply(`✅ <@${mentioned.id}> has been swear unblocked!`);
  }

  // Admin only — ban
  if (message.content.startsWith('!ban ')) {
    if (!isAdmin(message)) return message.reply('❌ You do not have permission to use this command.');
    const mentioned = message.mentions.members.first();
    if (!mentioned) return message.reply('❌ Example: `!ban @John 7 breaking rules`');
    const args = message.content.split(' ');
    const days = parseInt(args[2]);
    if (isNaN(days) || days < 1) return message.reply('❌ Example: `!ban @John 7 breaking rules`');
    const reason = args.slice(3).join(' ') || 'No reason provided';
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    await pool.query(`INSERT INTO banned_users (discord_id, expires_at, permanent) VALUES ($1, $2, FALSE) ON CONFLICT (discord_id) DO UPDATE SET expires_at = $2, permanent = FALSE`, [mentioned.id, expiresAt]);
    try { await mentioned.send(`🔨 You have been banned for **${days}** day(s).\n📋 Reason: **${reason}**`); } catch (e) {}
    await mentioned.ban({ reason: `${reason} (${days} day temp ban)` });
    message.reply(`🔨 <@${mentioned.id}> has been banned for **${days}** day(s).\n📋 Reason: **${reason}**`);
  }

  // Admin only — permaban
  if (message.content.startsWith('!permaban ')) {
    if (!isAdmin(message)) return message.reply('❌ You do not have permission to use this command.');
    const mentioned = message.mentions.members.first();
    if (!mentioned) return message.reply('❌ Example: `!permaban @John breaking rules`');
    const args = message.content.split(' ');
    const reason = args.slice(2).join(' ') || 'No reason provided';
    await pool.query(`INSERT INTO banned_users (discord_id, expires_at, permanent) VALUES ($1, NULL, TRUE) ON CONFLICT (discord_id) DO UPDATE SET expires_at = NULL, permanent = TRUE`, [mentioned.id]);
    try { await mentioned.send(`🔨 You have been **permanently banned**.\n📋 Reason: **${reason}**`); } catch (e) {}
    await mentioned.ban({ reason: `${reason} (permanent ban)` });
    message.reply(`🔨 <@${mentioned.id}> has been **permanently banned**.\n📋 Reason: **${reason}**`);
  }

  // Admin only — unban
  if (message.content.startsWith('!unban ')) {
    if (!isAdmin(message)) return message.reply('❌ You do not have permission to use this command.');
    const args = message.content.split(' ');
    const userId = args[1];
    if (!userId) return message.reply('❌ Provide a user ID! Example: `!unban 123456789`');
    await pool.query('DELETE FROM banned_users WHERE discord_id = $1', [userId]);
    try {
      await message.guild.members.unban(userId);
      message.reply(`✅ User **${userId}** has been unbanned!`);
    } catch (err) {
      message.reply('❌ Could not unban. Make sure the ID is correct!');
    }
  }

  // Admin only — lookup
  if (message.content.startsWith('!lookup')) {
    if (!isAdmin(message)) return message.reply('❌ You do not have permission to use this command.');
    const mentioned = message.mentions.members.first();
    if (!mentioned) return message.reply('Mention someone! Example: `!lookup @John`');
    const result = await pool.query('SELECT * FROM verified_users WHERE discord_id = $1', [mentioned.id]);
    const user = result.rows[0];
    if (!user) return message.reply('❌ That user has not verified yet.');
    try {
      await message.author.send(`🔒 Full name: **${user.first_name} ${user.last_name}** | Grade: **${user.grade}th**`);
      await message.delete();
    } catch (err) {
      message.reply('❌ Could not send you a DM!');
    }
  }
});

client.on('interactionCreate', async (interaction) => {

  // Grade buttons
  if (interaction.isButton() && ['grade_5', 'grade_6', 'grade_7', 'grade_8'].includes(interaction.customId)) {
    const grade = interaction.customId.split('_')[1];

    // Check if already verified
    const existing = await pool.query('SELECT * FROM verified_users WHERE discord_id = $1', [interaction.user.id]);
    if (existing.rows.length > 0) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_reverify_${grade}`).setLabel('Yes, update my info').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_reverify').setLabel('No, cancel').setStyle(ButtonStyle.Danger)
      );
      await interaction.reply({
        content: `⚠️ You are already verified as **${existing.rows[0].display_name}**. Do you want to update your information?`,
        components: [row],
        ephemeral: true
      });
      return;
    }

    // Check if already pending
    const pending = await pool.query('SELECT * FROM pending_verifications WHERE discord_id = $1', [interaction.user.id]);
    if (pending.rows.length > 0) {
      await interaction.reply({ content: '⏳ Your verification is already pending approval! Please wait.', ephemeral: true });
      return;
    }

    await showNameModal(interaction, grade);
  }

  // Confirm re-verify
  if (interaction.isButton() && interaction.customId.startsWith('confirm_reverify_')) {
    const grade = interaction.customId.split('_')[2];
    await showNameModal(interaction, grade);
  }

  // Cancel re-verify
  if (interaction.isButton() && interaction.customId === 'cancel_reverify') {
    await interaction.reply({ content: '✅ Verification cancelled.', ephemeral: true });
  }

  // Accept verification
  if (interaction.isButton() && interaction.customId.startsWith('approve_')) {
    const userId = interaction.customId.split('_')[1];
    const pending = await pool.query('SELECT * FROM pending_verifications WHERE discord_id = $1', [userId]);
    if (!pending.rows[0]) return interaction.reply({ content: '❌ Verification no longer exists.', ephemeral: true });

    const { first_name, last_name, grade } = pending.rows[0];
    const lastInitial = last_name[0].toUpperCase();
    const displayName = `${first_name} ${lastInitial}.`;

    await pool.query(`
      INSERT INTO verified_users (discord_id, first_name, last_name, grade, display_name)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (discord_id) DO UPDATE SET first_name=$2, last_name=$3, grade=$4, display_name=$5
    `, [userId, first_name, last_name, grade, displayName]);

    await pool.query('DELETE FROM pending_verifications WHERE discord_id = $1', [userId]);

    // Assign role and nickname
    try {
      for (const [, guild] of client.guilds.cache) {
        const member = await guild.members.fetch(userId);
        if (member) {
          const roleId = getRoleId(grade);
          await member.roles.add(roleId);
          await member.setNickname(displayName);
        }
      }
    } catch (err) { console.error('Could not set role/nickname:', err); }

    // DM the user
    try {
      const user = await client.users.fetch(userId);
      await user.send(`✅ Your verification has been **approved**!\n🏷️ Your title is: **${displayName}**`);
    } catch (e) {}

    await interaction.update({ content: `✅ Approved **${displayName}** (Grade ${grade})`, components: [] });
  }

  // Decline verification
  if (interaction.isButton() && interaction.customId.startsWith('decline_')) {
    const userId = interaction.customId.split('_')[1];
    await pool.query('DELETE FROM pending_verifications WHERE discord_id = $1', [userId]);

    try {
      const user = await client.users.fetch(userId);
      await user.send(`❌ Your verification was **declined**. Please try again and make sure to upload a clear screenshot of your Infinite Campus schedule.`);
    } catch (e) {}

    await interaction.update({ content: `❌ Declined verification for user ${userId}`, components: [] });
  }

  // Modal submission — name
  if (interaction.isModalSubmit() && interaction.customId.startsWith('name_modal_')) {
    const grade = interaction.customId.split('_')[2];
    const fullName = interaction.fields.getTextInputValue('full_name').trim();
    const parts = fullName.split(' ');

    if (parts.length < 2) {
      await interaction.reply({ content: '❌ Please enter both your **first and last name** (e.g. `John Smith`)', ephemeral: true });
      return;
    }

    const firstName = parts[0];
    const lastName = parts[parts.length - 1];

    // Save to pending
    await pool.query(`
      INSERT INTO pending_verifications (discord_id, first_name, last_name, grade)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (discord_id) DO UPDATE SET first_name=$2, last_name=$3, grade=$4
    `, [interaction.user.id, firstName, lastName, grade]);

    await interaction.reply({
      content: `✅ Name saved! Now please upload a **screenshot of your Infinite Campus schedule** in this channel to complete verification.\n\nGo to Infinite Campus → Click **Schedule** → Take a screenshot and send it here.`,
      ephemeral: true
    });
  }
});

// Handle screenshot upload for verification
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== VERIFY_CHANNEL_ID) return;
  if (message.attachments.size === 0) return;

  // Check if user has a pending verification
  const pending = await pool.query('SELECT * FROM pending_verifications WHERE discord_id = $1', [message.author.id]);
  if (!pending.rows[0]) return;

  const { first_name, last_name, grade } = pending.rows[0];
  const screenshotUrl = message.attachments.first().url;

  // Save screenshot URL
  await pool.query('UPDATE pending_verifications SET screenshot_url = $1 WHERE discord_id = $2', [screenshotUrl, message.author.id]);

  // DM the approver
  try {
    const approver = await client.users.fetch(APPROVER_ID);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve_${message.author.id}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`decline_${message.author.id}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger)
    );

    // Send info text first
    await approver.send(`📋 **New Verification Request**\n👤 User: ${message.author.tag} (<@${message.author.id}>)\n📝 Name: **${first_name} ${last_name}**\n🎓 Grade: **${grade}th Grade**\n🖼️ Schedule screenshot below:`);

    // Send the actual image file as attachment so it always loads
    const attachment = message.attachments.first();
    await approver.send({ files: [{ attachment: attachment.url, name: attachment.name }], components: [row] });

  } catch (err) {
    console.error('Could not DM approver:', err);
  }

  // Delete their screenshot from verify channel
  await message.delete();

  await message.channel.send({ content: `<@${message.author.id}> Your verification request has been submitted! Please wait for approval.`, });
  setTimeout(async () => {
    try { await (await message.channel.messages.fetch({ limit: 5 })).find(m => m.content.includes(message.author.id) && m.author.id === client.user.id)?.delete(); } catch (e) {}
  }, 10000);
});

// Helper function to show name modal
async function showNameModal(interaction, grade) {
  const modal = new ModalBuilder()
    .setCustomId(`name_modal_${grade}`)
    .setTitle('Enter Your Full Name');
  const nameInput = new TextInputBuilder()
    .setCustomId('full_name')
    .setLabel('Your Full Name (e.g. John Smith)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(50)
    .setPlaceholder('First Last');
  modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
  await interaction.showModal(modal);
}

client.login(TOKEN);
