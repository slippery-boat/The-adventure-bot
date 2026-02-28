const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const { Pool } = require('pg');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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
  'nigga', 'nigra', 'pigfucker', 'piss', 'prick', 'pussy', 'shit', 'shite',
  'sisterfuck', 'sisterfucker', 'slut', 'spastic', 'tranny', 'twat', 'wanker'
];

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
  console.log('✅ Database ready');
}

const TOKEN = process.env.TOKEN;
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID;
const GRADE_7_ROLE_ID = process.env.GRADE_7_ROLE_ID;
const GRADE_8_ROLE_ID = process.env.GRADE_8_ROLE_ID;
const OWNER_ID = process.env.OWNER_ID;

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await setupDatabase();
  await postVerifyMessage();
});

async function postVerifyMessage() {
  const channel = await client.channels.fetch(VERIFY_CHANNEL_ID);
  if (!channel) return;

  const messages = await channel.messages.fetch({ limit: 10 });
  const alreadyPosted = messages.some(m => m.author.id === client.user.id);
  if (alreadyPosted) return;

  const embed = new EmbedBuilder()
    .setTitle('✅ Server Verification')
    .setDescription('Welcome! To gain access to the server please verify below.\n\n**Step 1:** Choose your grade\n**Step 2:** Enter your full name')
    .setColor(0x5865F2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('grade_7')
      .setLabel('7th Grade')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('grade_8')
      .setLabel('8th Grade')
      .setStyle(ButtonStyle.Success)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// Auto-unverify when someone leaves the server
client.on('guildMemberRemove', async (member) => {
  try {
    await pool.query('DELETE FROM verified_users WHERE discord_id = $1', [member.id]);
    await pool.query('DELETE FROM swear_blocks WHERE discord_id = $1', [member.id]);
    console.log(`🗑️ Removed ${member.user.tag} from database (left server)`);
  } catch (err) {
    console.error('Error removing user from database:', err);
  }
});

// Check messages for swear words
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Check if user is swear blocked
  const blockResult = await pool.query(
    'SELECT * FROM swear_blocks WHERE discord_id = $1 AND expires_at > NOW()',
    [message.author.id]
  );

  if (blockResult.rows.length > 0) {
    const messageWords = message.content.toLowerCase().split(/\s+/);
    const foundSwear = messageWords.some(word =>
      SWEAR_WORDS.includes(word.replace(/[^a-z-]/g, ''))
    );

    if (foundSwear) {
      await message.delete();
      const expiresAt = new Date(blockResult.rows[0].expires_at);
      const daysLeft = Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24));
      await message.channel.send(`⛔ <@${message.author.id}> You are blocked from using swear words for **${daysLeft}** more day(s).`);
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

  // Admin only — block swearing for a user
  // Usage: !swearblock @user 7
  if (message.content.startsWith('!swearblock')) {
    if (message.author.id !== OWNER_ID) {
      message.reply('❌ You do not have permission to use this command.');
      return;
    }

    const mentioned = message.mentions.members.first();
    if (!mentioned) return message.reply('❌ Mention someone! Example: `!swearblock @John 7`');

    const args = message.content.split(' ');
    const days = parseInt(args[args.length - 1]);

    if (isNaN(days) || days < 1) {
      return message.reply('❌ Please provide a number of days! Example: `!swearblock @John 7`');
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    await pool.query(`
      INSERT INTO swear_blocks (discord_id, expires_at)
      VALUES ($1, $2)
      ON CONFLICT (discord_id) DO UPDATE SET expires_at = $2
    `, [mentioned.id, expiresAt]);

    message.reply(`✅ <@${mentioned.id}> has been swear blocked for **${days}** day(s).`);
  }

  // Admin only — unblock swearing for a user
  // Usage: !swearunblock @user
  if (message.content.startsWith('!swearunblock')) {
    if (message.author.id !== OWNER_ID) {
      message.reply('❌ You do not have permission to use this command.');
      return;
    }

    const mentioned = message.mentions.members.first();
    if (!mentioned) return message.reply('❌ Mention someone! Example: `!swearunblock @John`');

    await pool.query('DELETE FROM swear_blocks WHERE discord_id = $1', [mentioned.id]);
    message.reply(`✅ <@${mentioned.id}> has been swear unblocked!`);
  }

  // Admin only — shows full name privately via DM
  if (message.content.startsWith('!lookup')) {
    if (message.author.id !== OWNER_ID) {
      message.reply('❌ You do not have permission to use this command.');
      return;
    }

    const mentioned = message.mentions.members.first();
    if (!mentioned) return message.reply('Mention someone! Example: `!lookup @John`');

    const result = await pool.query('SELECT * FROM verified_users WHERE discord_id = $1', [mentioned.id]);
    const user = result.rows[0];

    if (!user) return message.reply('❌ That user has not verified yet.');

    try {
      await message.author.send(`🔒 Full name: **${user.first_name} ${user.last_name}** | Grade: **${user.grade}th**`);
      await message.delete();
    } catch (err) {
      message.reply('❌ Could not send you a DM! Make sure your DMs are open.');
    }
  }
});

client.on('interactionCreate', async (interaction) => {

  if (interaction.isButton() && (interaction.customId === 'grade_7' || interaction.customId === 'grade_8')) {
    const grade = interaction.customId === 'grade_7' ? '7' : '8';

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

  if (interaction.isModalSubmit() && interaction.customId.startsWith('name_modal_')) {
    const grade = interaction.customId.split('_')[2];
    const fullName = interaction.fields.getTextInputValue('full_name').trim();
    const parts = fullName.split(' ');

    if (parts.length < 2) {
      await interaction.reply({
        content: '❌ Please enter both your **first and last name** (e.g. `John Smith`)',
        ephemeral: true
      });
      return;
    }

    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    const lastInitial = lastName[0].toUpperCase();
    const displayName = `${firstName} ${lastInitial}.`;

    await pool.query(`
      INSERT INTO verified_users (discord_id, first_name, last_name, grade, display_name)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (discord_id) DO UPDATE
      SET first_name = $2, last_name = $3, grade = $4, display_name = $5
    `, [interaction.user.id, firstName, lastName, grade, displayName]);

    const member = interaction.member;
    const roleId = grade === '7' ? GRADE_7_ROLE_ID : GRADE_8_ROLE_ID;

    try {
      const otherRoleId = grade === '7' ? GRADE_8_ROLE_ID : GRADE_7_ROLE_ID;
      if (member.roles.cache.has(otherRoleId)) await member.roles.remove(otherRoleId);
      await member.roles.add(roleId);
      await member.setNickname(displayName);
      console.log(`✅ Verified ${member.user.tag} as grade ${grade} with name ${displayName}`);
    } catch (err) {
      console.error('Could not set role/nickname:', err);
    }

    await interaction.reply({
      content: `✅ Verified as **Grade ${grade}**!\n🏷️ Your title is: **${displayName}**\n\nYour last name is kept private.`,
      ephemeral: true
    });
  }
});

client.login(TOKEN);
