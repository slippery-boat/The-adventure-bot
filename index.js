const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const Database = require('better-sqlite3');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

const db = new Database('users.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS verified_users (
    discord_id TEXT PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    grade TEXT,
    display_name TEXT
  )
`);

const TOKEN = process.env.TOKEN;
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID;
const GRADE_7_ROLE_ID = process.env.GRADE_7_ROLE_ID;
const GRADE_8_ROLE_ID = process.env.GRADE_8_ROLE_ID;
const OWNER_ID = process.env.OWNER_ID;

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`GRADE_7_ROLE_ID: ${GRADE_7_ROLE_ID}`);
  console.log(`GRADE_8_ROLE_ID: ${GRADE_8_ROLE_ID}`);
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

    db.prepare(`
      INSERT OR REPLACE INTO verified_users (discord_id, first_name, last_name, grade, display_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(interaction.user.id, firstName, lastName, grade, displayName);

    const member = interaction.member;
    const roleId = grade === '7' ? GRADE_7_ROLE_ID : GRADE_8_ROLE_ID;

    console.log(`Trying to assign role ${roleId} to ${member.user.tag}`);

    try {
      const otherRoleId = grade === '7' ? GRADE_8_ROLE_ID : GRADE_7_ROLE_ID;
      if (member.roles.cache.has(otherRoleId)) await member.roles.remove(otherRoleId);
      await member.roles.add(roleId);
      console.log(`✅ Role assigned successfully to ${member.user.tag}`);
      await member.setNickname(displayName);
      console.log(`✅ Nickname set to ${displayName}`);
    } catch (err) {
      console.error('Could not set role/nickname full error:', err);
    }

    await interaction.reply({
      content: `✅ Verified as **Grade ${grade}**!\n🏷️ Your title is: **${displayName}**\n\nYour last name is kept private.`,
      ephemeral: true
    });
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Public — anyone can see titles
  if (message.content.startsWith('!whois')) {
    const mentioned = message.mentions.members.first();
    const targetId = mentioned ? mentioned.id : message.author.id;

    const user = db.prepare('SELECT * FROM verified_users WHERE discord_id = ?').get(targetId);
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

  // Admin only — shows full name privately
  if (message.content.startsWith('!lookup')) {
    if (message.author.id !== OWNER_ID) {
      message.reply('❌ You do not have permission to use this command.');
      return;
    }

    const mentioned = message.mentions.members.first();
    if (!mentioned) return message.reply('Mention someone! Example: `!lookup @John`');

    const user = db.prepare('SELECT * FROM verified_users WHERE discord_id = ?').get(mentioned.id);
    if (!user) return message.reply('❌ That user has not verified yet.');

    message.reply({ content: `🔒 Full name: **${user.first_name} ${user.last_name}** | Grade: **${user.grade}th**`, ephemeral: true });
  }
});

client.login(TOKEN);
