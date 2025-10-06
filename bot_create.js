// bot_create.js — initial setup only (no updates), Windows-ready
// Usage:
//   1) npm init -y && npm install discord.js dotenv
//   2) Create .env with DISCORD_TOKEN=... and GUILD_ID=...
//   3) node bot_create.js

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const TEMPLATE_PATH = path.join(__dirname, 'Eureka 4720 Template.json');

if (!TOKEN || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN or GUILD_ID in .env');
  process.exit(1);
}

if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error('Template JSON not found:', TEMPLATE_PATH);
  process.exit(1);
}

const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.fetch();

  // ---- ROLES ----
  const wantRoles = [
    ...template.server.language_roles,
    ...template.server.functional_roles
  ];

  const rolesCache = await guild.roles.fetch();
  const ensureRole = async (name, perms=[]) => {
    let role = rolesCache.find(r => r && r.name === name);
    if (role) { console.log('Role exists:', name); return role; }
    role = await guild.roles.create({
      name,
      permissions: perms,
      reason: 'Bootstrap from template'
    });
    console.log('Role created:', name);
    return role;
  };

  const everyone = guild.roles.everyone;
  const adminRole = await ensureRole('👑 Administrator', [PermissionsBitField.Flags.Administrator]);
  const modRole   = await ensureRole('🛠 Moderator', [
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.MuteMembers,
    PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.BanMembers
  ]);

  for (const name of template.server.language_roles) {
    await ensureRole(name);
  }
  for (const name of template.server.functional_roles) {
    if (name === '👑 Administrator' || name === '🛠 Moderator') continue;
    await ensureRole(name);
  }

  // Map for quick lookup
  const freshRoles = await guild.roles.fetch();
  const roleByName = (n) => freshRoles.find(r => r && r.name === n);
  const viewAllow = PermissionsBitField.Flags.ViewChannel;
  const sendDeny  = PermissionsBitField.Flags.SendMessages;
  const connect   = PermissionsBitField.Flags.Connect;

  // ---- CATEGORIES & CHANNELS ----
  const chanCache = await guild.channels.fetch();
  const ensureCategory = async (name, isPrivate=false) => {
    let cat = chanCache.find(c => c && c.type === ChannelType.GuildCategory && c.name === name);
    if (cat) { console.log('Category exists:', name); return cat; }
    const overwrites = [];
    if (isPrivate) {
      overwrites.push({ id: everyone.id, deny: [viewAllow] });
      if (adminRole) overwrites.push({ id: adminRole.id, allow: [viewAllow] });
      if (modRole)   overwrites.push({ id: modRole.id, allow: [viewAllow] });
    }
    cat = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwrites,
      reason: 'Bootstrap from template'
    });
    console.log('Category created:', name);
    return cat;
  };

  const ensureText = async (name, parent, opts={}) => {
    let ch = chanCache.find(c => c && c.type === ChannelType.GuildText && c.name === name);
    if (ch) { console.log('Text exists:', name); return ch; }
    const overwrites = [];
    if (opts.private) {
      overwrites.push({ id: everyone.id, deny: [viewAllow] });
      if (adminRole) overwrites.push({ id: adminRole.id, allow: [viewAllow] });
      if (modRole)   overwrites.push({ id: modRole.id, allow: [viewAllow] });
    }
    if (opts.read_only) {
      // deny sending to everyone, still visible
      overwrites.push({ id: everyone.id, deny: [sendDeny] });
    }
    ch = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parent.id,
      topic: opts.topic || null,
      permissionOverwrites: overwrites,
      reason: 'Bootstrap from template'
    });
    console.log('Text created:', name);
    return ch;
  };

  const ensureVoice = async (name, parent, opts={}) => {
    let ch = chanCache.find(c => c && c.type === ChannelType.GuildVoice && c.name === name);
    if (ch) { console.log('Voice exists:', name); return ch; }
    const overwrites = [];
    if (opts.private) {
      overwrites.push({ id: everyone.id, deny: [viewAllow, connect] });
      if (adminRole) overwrites.push({ id: adminRole.id, allow: [viewAllow, connect] });
      if (modRole)   overwrites.push({ id: modRole.id, allow: [viewAllow, connect] });
    }
    ch = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: parent.id,
      permissionOverwrites: overwrites,
      reason: 'Bootstrap from template'
    });
    console.log('Voice created:', name);
    return ch;
  };

  // Create flattened categories
  for (const cat of template.server.categories) {
    const isPrivateBlock = (cat.name || '').toUpperCase().includes('VIP') ||
                           (cat.name || '').toUpperCase().includes('DISCIPLINE') ||
                           (cat.name || '').toUpperCase().includes('ADMIN');
    const parent = await ensureCategory(cat.name, isPrivateBlock);

    // direct channels
    if (Array.isArray(cat.channels)) {
      for (const ch of cat.channels) {
        const opts = { private: !!ch.private, read_only: !!ch.read_only, topic: ch.topic || null };
        if (ch.type === 'text') await ensureText(ch.name, parent, opts);
        else if (ch.type === 'voice') await ensureVoice(ch.name, parent, opts);
      }
    }

    // nested "children" not expected now (we flattened in template). Kept for compatibility
    if (Array.isArray(cat.children)) {
      for (const sub of cat.children) {
        const subParent = await ensureCategory(`${cat.name} — ${sub.name}`, isPrivateBlock);
        for (const ch of (sub.channels||[])) {
          const opts = { private: !!ch.private, read_only: !!ch.read_only, topic: ch.topic || null };
          if (ch.type === 'text') await ensureText(ch.name, subParent, opts);
          else if (ch.type === 'voice') await ensureVoice(ch.name, subParent, opts);
        }
      }
    }
  }

  console.log('Initial creation complete. Assign yourself the 👑 Administrator role in server settings.');
  console.log('You can stop the bot now.');
  process.exit(0);
});

client.login(TOKEN).catch(err => {
  console.error('Login error:', err);
  process.exit(1);
});
