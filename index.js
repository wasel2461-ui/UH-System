require('dotenv').config();
const path = require('path');
const fs = require('fs');
const store = require('./data/store');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  AttachmentBuilder,
  AuditLogEvent,
  PermissionsBitField,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,        // لازم لرسالة الترحيب + لوق الرتب
    GatewayIntentBits.GuildMessages,       // لازم عشان يقرأ الرسايل النصية
    GatewayIntentBits.MessageContent,      // لازم عشان يقرأ محتوى الرسايل النصية
    GatewayIntentBits.GuildModeration,     // لازم للوق الحظر/فك الحظر
    GatewayIntentBits.GuildVoiceStates,    // لازم للوق دخول/خروج الفويس
  ],
  partials: [Partials.GuildMember],
});

// ============ نظام اللوق: يرسل كل الأحداث لقناة واحدة مع شعار ثابت ============
const LOG_BANNER_PATH = path.join(__dirname, 'assets', 'log-banner.png');

// حماية من التكرار: لو نفس الحدث بالضبط انبعث أكثر من مرة خلال ثوانٍ قليلة
// (يصير أحيانًا من ديسكورد نفسه أو بوتات ثانية)، نرسله مرة وحدة بس
const recentLogs = new Map();
const DEDUP_WINDOW_MS = 4000;

function isDuplicateLog(guildId, title, fields) {
  const key = `${guildId}|${title}|${JSON.stringify(fields)}`;
  const now = Date.now();
  const last = recentLogs.get(key);

  // تنظيف الإدخالات القديمة بين فترة وفترة عشان الـ Map ما يكبر بلا داعي
  if (recentLogs.size > 500) {
    for (const [k, t] of recentLogs) {
      if (now - t > DEDUP_WINDOW_MS) recentLogs.delete(k);
    }
  }

  if (last && now - last < DEDUP_WINDOW_MS) return true;
  recentLogs.set(key, now);
  return false;
}

async function sendLog(guild, { title, description, color = 0xC9A227, fields = [] }) {
  try {
    const channelId = process.env.LOG_CHANNEL_ID;
    if (!channelId) return;

    if (isDuplicateLog(guild.id, title, fields)) return; // نفس الحدث انسجل قبل شوي، تجاهل

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: title })
      .setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined })
      .setTimestamp();

    if (description) embed.setDescription(description);
    if (fields.length) embed.addFields(fields);

    const hasBanner = fs.existsSync(LOG_BANNER_PATH);
    const payload = { embeds: [embed] };

    if (hasBanner) {
      embed.setThumbnail('attachment://log-banner.png');
      payload.files = [new AttachmentBuilder(LOG_BANNER_PATH, { name: 'log-banner.png' })];
    }

    await channel.send(payload);
  } catch (err) {
    console.error('خطأ بإرسال اللوق:', err);
  }
}

// يحاول يجيب منفّذ الإجراء (executor) من سجل التدقيق تبع ديسكورد
async function getExecutor(guild, auditType, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditType, limit: 5 });
    const entry = logs.entries.find(e => e.target?.id === targetId && Date.now() - e.createdTimestamp < 10000);
    return entry ? entry.executor : null;
  } catch {
    return null;
  }
}

// يرجع منشن الشخص اللي نفّذ الأمر فعليًا (مو البوت) — يُستخدم داخل أوامرنا مباشرة
// عشان اللوق يوضح المشرف الحقيقي بدل ما يعتمد على سجل التدقيق (اللي يعرض البوت كمنفّذ)
function mentionExecutor(ctx) {
  return ctx.executorId ? `<@${ctx.executorId}>` : 'غير معروف';
}

// نتجاهل لوق الحدث لو منفّذه هو البوت نفسه (يعني صار عن طريق أحد أوامرنا،
// وأصلاً انسجل بلوق مباشر فيه هوية المشرف الحقيقي — تفادي التكرار والالتباس)
function isBotItself(guild, executor) {
  return executor && guild.client.user && executor.id === guild.client.user.id;
}

client.once('ready', async () => {
  console.log(`✅ البوت شغال باسم: ${client.user.tag}`);

  // نجيب كل أعضاء كل سيرفر عشان الكاش يكون معبّى من أول لحظة
  // (بدونها، تغيير الرتب ما يتسجل صح إلا بعد أول تفاعل مع كل عضو)
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.members.fetch();
      console.log(`📥 تم تحميل أعضاء سيرفر: ${guild.name} (${guild.memberCount} عضو)`);
    } catch (err) {
      console.error(`فشل تحميل أعضاء سيرفر ${guild.name}:`, err.message);
    }
  }
});

// حماية عامة: أي خطأ غير متوقع يتسجل بالـ Terminal بدل ما يوقف البوت كامل
client.on('error', err => console.error('خطأ بالبوت (Client):', err));
process.on('unhandledRejection', err => console.error('خطأ غير متوقع (unhandledRejection):', err));

// ============ تحويل صيغة المدة (30m / 1h / 2d) إلى ميلي ثانية ============
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // أقصى مدة يدعمها ديسكورد: 28 يوم

function parseDurationToMs(input) {
  if (!input) return null;
  const match = String(input).trim().toLowerCase().match(/^(\d+)\s*(s|m|h|d)?$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2] || 'm'; // افتراضيًا دقائق لو ما كتب وحدة

  const unitMs = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  const ms = value * unitMs[unit];

  if (ms <= 0 || ms > MAX_TIMEOUT_MS) return null;
  return ms;
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ساعة`;
  const days = Math.round(hours / 24);
  return `${days} يوم`;
}

// ============ رسالة الترحيب عند انضمام عضو جديد ============
client.on('guildMemberAdd', async member => {
  try {
    const channelId = process.env.WELCOME_CHANNEL_ID;
    if (!channelId) return;

    const channel = await member.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('عضو جديد انضم! 🎉')
      .setDescription(`أهلاً وسهلاً ${member} بسيرفر **${member.guild.name}**!`)
      .setThumbnail(member.user.displayAvatarURL())
      .addFields({ name: 'عدد الأعضاء الآن', value: `${member.guild.memberCount}` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('خطأ برسالة الترحيب:', err);
  }
});

// ==================================================================
// نظام اللوق الشامل — يلتقط أي تغيير بالسيرفر تلقائيًا
// (سواء صار عن طريق أوامر البوت أو يدويًا من أي مشرف)
// ==================================================================

client.on('guildBanAdd', async ban => {
  const executor = await getExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
  if (isBotItself(ban.guild, executor)) return; // انسجل مباشرة بأمر /حظر بهوية المشرف الحقيقي
  await sendLog(ban.guild, {
    title: '⛔ حظر عضو',
    color: 0xED4245,
    fields: [
      { name: 'العضو', value: `${ban.user.tag} (${ban.user.id})` },
      { name: 'بواسطة', value: executor ? executor.tag : 'غير معروف' },
      { name: 'السبب', value: ban.reason || 'ما تم تحديد سبب' },
    ],
  });
});

client.on('guildBanRemove', async ban => {
  const executor = await getExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
  if (isBotItself(ban.guild, executor)) return;
  await sendLog(ban.guild, {
    title: '✅ إلغاء حظر عضو',
    color: 0x57F287,
    fields: [
      { name: 'العضو', value: `${ban.user.tag} (${ban.user.id})` },
      { name: 'بواسطة', value: executor ? executor.tag : 'غير معروف' },
    ],
  });
});

client.on('roleCreate', async role => {
  const executor = await getExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
  if (isBotItself(role.guild, executor)) return;
  await sendLog(role.guild, {
    title: '➕ إنشاء رول',
    color: 0x57F287,
    fields: [
      { name: 'الرول', value: `${role}` },
      { name: 'بواسطة', value: executor ? executor.tag : 'غير معروف' },
    ],
  });
});

client.on('roleDelete', async role => {
  const executor = await getExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
  if (isBotItself(role.guild, executor)) return;
  await sendLog(role.guild, {
    title: '➖ حذف رول',
    color: 0xED4245,
    fields: [
      { name: 'الرول', value: role.name },
      { name: 'بواسطة', value: executor ? executor.tag : 'غير معروف' },
    ],
  });
});

client.on('channelCreate', async channel => {
  if (!channel.guild) return;
  const executor = await getExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  if (isBotItself(channel.guild, executor)) return;
  await sendLog(channel.guild, {
    title: '➕ إنشاء روم',
    color: 0x57F287,
    fields: [
      { name: 'الروم', value: `${channel}` },
      { name: 'بواسطة', value: executor ? executor.tag : 'غير معروف' },
    ],
  });
});

client.on('channelDelete', async channel => {
  if (!channel.guild) return;
  const executor = await getExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  if (isBotItself(channel.guild, executor)) return;
  await sendLog(channel.guild, {
    title: '➖ حذف روم',
    color: 0xED4245,
    fields: [
      { name: 'الروم', value: `#${channel.name}` },
      { name: 'بواسطة', value: executor ? executor.tag : 'غير معروف' },
    ],
  });
});

// إعطاء/سحب رتبة + الكتم/فك الكتم — كلهم يظهرون كتغيير بمعلومات العضو (guildMemberUpdate)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  // --- تغيير اللقب (Nickname) ---
  if (oldMember.nickname !== newMember.nickname) {
    const executor = await getExecutor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
    if (!isBotItself(newMember.guild, executor)) {
      await sendLog(newMember.guild, {
        title: '✏️ تغيير لقب عضو',
        color: 0x5865F2,
        fields: [
          { name: 'العضو', value: `${newMember} (${newMember.id})` },
          { name: 'بواسطة', value: executor ? executor.tag : 'غير معروف' },
          { name: 'من', value: oldMember.nickname || '(بدون لقب)', inline: true },
          { name: 'إلى', value: newMember.nickname || '(بدون لقب)', inline: true },
        ],
      });
    }
  }

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  const addedRoles = newRoles.filter(r => !oldRoles.has(r.id));
  const removedRoles = oldRoles.filter(r => !newRoles.has(r.id));

  if (addedRoles.size > 0 || removedRoles.size > 0) {
    const executor = await getExecutor(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
    if (!isBotItself(newMember.guild, executor)) {
      const fields = [
        { name: 'العضو', value: `${newMember} (${newMember.id})` },
        { name: 'بواسطة', value: executor ? executor.tag : 'غير معروف' },
      ];
      if (addedRoles.size) fields.push({ name: 'رولات أُضيفت', value: addedRoles.map(r => `${r}`).join(', ') });
      if (removedRoles.size) fields.push({ name: 'رولات أُزيلت', value: removedRoles.map(r => `${r}`).join(', ') });

      await sendLog(newMember.guild, { title: '🎭 تعديل رولات عضو', color: 0x5865F2, fields });
    }
  }

  const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
  const newTimeout = newMember.communicationDisabledUntilTimestamp;

  if (oldTimeout !== newTimeout) {
    if (newTimeout && newTimeout > Date.now()) {
      const executor = await getExecutor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
      if (!isBotItself(newMember.guild, executor)) {
        await sendLog(newMember.guild, {
          title: '🔇 كتم عضو (تايم)',
          color: 0xFEE75C,
          fields: [
            { name: 'العضو', value: `${newMember} (${newMember.id})` },
            { name: 'بواسطة', value: executor ? executor.tag : 'غير معروف' },
            { name: 'ينفك', value: `<t:${Math.floor(newTimeout / 1000)}:R>` },
          ],
        });
      }
    } else if (oldTimeout && (!newTimeout || newTimeout <= Date.now())) {
      const executor = await getExecutor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
      if (!isBotItself(newMember.guild, executor)) {
        await sendLog(newMember.guild, {
          title: '🔊 فك كتم عضو (تايم)',
          color: 0x57F287,
          fields: [
            { name: 'العضو', value: `${newMember} (${newMember.id})` },
            { name: 'بواسطة', value: executor ? executor.tag : 'غير معروف' },
          ],
        });
      }
    }
  }
});

// طرد مقابل مغادرة طوعية — نفرّق بينهم عن طريق سجل التدقيق
client.on('guildMemberRemove', async member => {
  try {
    const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 5 });
    const entry = logs.entries.find(e => e.target?.id === member.id && Date.now() - e.createdTimestamp < 10000);

    if (entry && !isBotItself(member.guild, entry.executor)) {
      await sendLog(member.guild, {
        title: '👢 طرد عضو (Kick)',
        color: 0xED4245,
        fields: [
          { name: 'العضو', value: `${member.user.tag} (${member.id})` },
          { name: 'بواسطة', value: entry.executor ? entry.executor.tag : 'غير معروف' },
          { name: 'السبب', value: entry.reason || 'ما تم تحديد سبب' },
        ],
      });
    }
  } catch (err) {
    console.error('خطأ بفحص سبب مغادرة العضو:', err);
  }
});

// دخول/خروج/تنقل بالفويس (الطرد الصوتي، الكتم، والنقل تنسجل مباشرة داخل أوامرنا)
client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member) return;

  if (!oldState.channel && newState.channel) {
    await sendLog(newState.guild, {
      title: '🎙️ دخول فويس',
      color: 0x5865F2,
      fields: [
        { name: 'العضو', value: `${member}` },
        { name: 'الروم', value: `${newState.channel}` },
      ],
    });
  } else if (oldState.channel && !newState.channel) {
    // نتحقق إذا كان طرد صوتي مقصود (وسجّله بالفعل أمر /طرد_صوت)، أو مجرد خروج طبيعي
    const executor = await getExecutor(oldState.guild, AuditLogEvent.MemberDisconnect, member.id);
    if (isBotItself(oldState.guild, executor)) {
      // انسجل مباشرة بأمر /طرد_صوت، تجاهل هنا
    } else if (executor) {
      await sendLog(oldState.guild, {
        title: '🔇 طرد صوتي',
        color: 0xED4245,
        fields: [
          { name: 'العضو', value: `${member}` },
          { name: 'الروم', value: `${oldState.channel}` },
          { name: 'بواسطة', value: executor.tag },
        ],
      });
    } else {
      await sendLog(oldState.guild, {
        title: '🔈 خروج من الفويس',
        color: 0x99AAB5,
        fields: [
          { name: 'العضو', value: `${member}` },
          { name: 'الروم', value: `${oldState.channel}` },
        ],
      });
    }
  } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
    // النقل عن طريق أمرنا /نقل ينسجل مباشرة داخل الأمر — هنا فقط للتنقل اليدوي من العضو نفسه
    const executor = await getExecutor(newState.guild, AuditLogEvent.MemberMove, member.id);
    if (!isBotItself(newState.guild, executor)) {
      await sendLog(newState.guild, {
        title: '🔄 تنقّل فويس',
        color: 0x5865F2,
        fields: [
          { name: 'العضو', value: `${member}` },
          { name: 'من', value: `${oldState.channel}`, inline: true },
          { name: 'إلى', value: `${newState.channel}`, inline: true },
        ],
      });
    }
  }

  // --- كتم/فك كتم المايك (Server Mute) ---
  if (oldState.serverMute !== newState.serverMute && newState.channel) {
    const executor = await getExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
    if (!isBotItself(newState.guild, executor)) {
      await sendLog(newState.guild, {
        title: newState.serverMute ? '🔇 كتم مايك عضو' : '🔊 فك كتم مايك عضو',
        color: newState.serverMute ? 0xFEE75C : 0x57F287,
        fields: [
          { name: 'العضو', value: `${member}` },
          { name: 'بواسطة', value: executor ? executor.tag : 'غير معروف' },
        ],
      });
    }
  }
});

// --- لوق حذف/تعديل الرسائل ---
client.on('messageDelete', async message => {
  if (!message.guild || message.author?.bot) return;
  const executor = await getExecutor(message.guild, AuditLogEvent.MessageDelete, message.author?.id).catch(() => null);
  await sendLog(message.guild, {
    title: '🗑️ حذف رسالة',
    color: 0xED4245,
    fields: [
      { name: 'العضو', value: message.author ? `${message.author.tag}` : 'غير معروف' },
      { name: 'الروم', value: `${message.channel}` },
      { name: 'بواسطة', value: executor ? executor.tag : 'غير معروف (يمكن العضو نفسه)' },
      { name: 'المحتوى', value: message.content ? message.content.slice(0, 1000) : '(بدون نص — صورة/ملف مثلًا)' },
    ],
  });
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return; // تجاهل تحديثات ما فيها تغيير نص فعلي (زي embeds)

  await sendLog(newMessage.guild, {
    title: '✏️ تعديل رسالة',
    color: 0xFEE75C,
    fields: [
      { name: 'العضو', value: `${newMessage.author.tag}` },
      { name: 'الروم', value: `${newMessage.channel}` },
      { name: 'قبل', value: oldMessage.content ? oldMessage.content.slice(0, 500) : '(فاضي)' },
      { name: 'بعد', value: newMessage.content ? newMessage.content.slice(0, 500) : '(فاضي)' },
    ],
  });
});

// ==================================================================
// المنطق المشترك للأوامر — يستخدمه كل من الـ Slash Commands
// وأوامر النص العادي (مسح 10 / كتم @شخص ...)
// كل دالة تاخذ:
//   ctx = { guild, channel, member(منفذ الأمر), reply(دالة للرد) }
//   والقيم اللي يحتاجها الأمر
// ==================================================================

async function runClear(ctx, amount) {
  amount = amount || 100; // بدون رقم = يحذف أكبر عدد ممكن دفعة وحدة (100 هو أقصى حد يسمح فيه ديسكورد بكل مرة)
  if (amount < 1 || amount > 100) {
    return ctx.reply('❌ لازم تحدد عدد بين 1 و100.');
  }
  if (!ctx.channel.permissionsFor(ctx.guild.members.me).has(PermissionsBitField.Flags.ManageMessages)) {
    return ctx.reply('❌ ما عندي صلاحية إدارة الرسائل بهذي القناة.');
  }
  const deleted = await ctx.channel.bulkDelete(amount, true);
  return ctx.replyTemp(`🧹 تم حذف ${deleted.size} رسالة.`);
}

async function runMute(ctx, targetUser, durationInput, reason) {
  reason = reason || 'ما تم تحديد سبب';
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو (منشن أو اختيار).');

  const ms = parseDurationToMs(durationInput);
  if (!ms) {
    return ctx.reply('❌ صيغة المدة غير صحيحة. اكتبها مثل: 30m (دقايق) أو 1h (ساعة) أو 2d (يوم) — أقصى مدة 28 يوم.');
  }

  const targetMember = await ctx.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) return ctx.reply('❌ ما لقيت هذا العضو بالسيرفر.');
  if (!targetMember.moderatable) return ctx.reply('❌ ما أقدر أكتم هذا العضو (رتبته أعلى مني أو مساوية — تأكد إن رتبة البوت أعلى من رتبته بإعدادات السيرفر).');

  await targetMember.timeout(ms, reason);

  const unmuteTimestamp = Math.floor((Date.now() + ms) / 1000);
  // رسالة خاصة للعضو المكتوم فيها عداد وقت حي (يتحدث لحاله بديسكورد)
  await targetUser.send(
    `🔇 تم كتمك بسيرفر **${ctx.guild.name}**\n` +
    `**السبب:** ${reason}\n` +
    `**بينفك الكتم:** <t:${unmuteTimestamp}:R> (بتاريخ <t:${unmuteTimestamp}:F>)`
  ).catch(() => null);

  await sendLog(ctx.guild, {
    title: '🔇 كتم عضو (تايم)',
    color: 0xFEE75C,
    fields: [
      { name: 'العضو', value: `${targetUser} (${targetUser.id})` },
      { name: 'بواسطة', value: mentionExecutor(ctx) },
      { name: 'المدة', value: formatDuration(ms), inline: true },
      { name: 'ينفك', value: `<t:${unmuteTimestamp}:R>`, inline: true },
      { name: 'السبب', value: reason },
    ],
  });

  return ctx.reply(`🔇 تم كتم ${targetUser} لمدة ${formatDuration(ms)}.\n**السبب:** ${reason}`);
}

async function runUnmute(ctx, targetUser) {
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو.');
  const targetMember = await ctx.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) return ctx.reply('❌ ما لقيت هذا العضو بالسيرفر.');

  await targetMember.timeout(null);
  await sendLog(ctx.guild, {
    title: '🔊 فك كتم عضو (تايم)',
    color: 0x57F287,
    fields: [
      { name: 'العضو', value: `${targetUser} (${targetUser.id})` },
      { name: 'بواسطة', value: mentionExecutor(ctx) },
    ],
  });
  return ctx.reply(`🔊 تم إلغاء كتم ${targetUser}.`);
}

async function runKick(ctx, targetUser, reason) {
  reason = reason || 'ما تم تحديد سبب';
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو.');

  const targetMember = await ctx.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) return ctx.reply('❌ ما لقيت هذا العضو بالسيرفر.');
  if (!targetMember.kickable) return ctx.reply('❌ ما أقدر أطرد هذا العضو (يمكن رتبته أعلى مني).');

  await targetMember.kick(reason);
  await sendLog(ctx.guild, {
    title: '👢 طرد عضو (Kick)',
    color: 0xED4245,
    fields: [
      { name: 'العضو', value: `${targetUser.tag} (${targetUser.id})` },
      { name: 'بواسطة', value: mentionExecutor(ctx) },
      { name: 'السبب', value: reason },
    ],
  });
  return ctx.reply(`👢 تم طرد ${targetUser}.\n**السبب:** ${reason}`);
}

async function runBan(ctx, targetUser, reason) {
  reason = reason || 'ما تم تحديد سبب';
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو.');

  if (ctx.executorId !== ctx.guild.ownerId) {
    return ctx.reply('❌ أمر الحظر متاح فقط لمالك السيرفر.');
  }

  const targetMember = await ctx.guild.members.fetch(targetUser.id).catch(() => null);
  if (targetMember && !targetMember.bannable) return ctx.reply('❌ ما أقدر أحظر هذا العضو (يمكن رتبته أعلى مني).');

  await ctx.guild.members.ban(targetUser.id, { reason });
  await sendLog(ctx.guild, {
    title: '⛔ حظر عضو',
    color: 0xED4245,
    fields: [
      { name: 'العضو', value: `${targetUser.tag} (${targetUser.id})` },
      { name: 'بواسطة', value: mentionExecutor(ctx) },
      { name: 'السبب', value: reason },
    ],
  });
  return ctx.reply(`⛔ تم حظر ${targetUser}.\n**السبب:** ${reason}`);
}

async function runWarn(ctx, targetUser, reason) {
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو.');
  if (!reason) return ctx.reply('❌ لازم تكتب سبب التحذير.');

  const byMention = ctx.executorId ? `<@${ctx.executorId}>` : 'غير معروف';
  const total = store.addWarning(ctx.guild.id, targetUser.id, reason, byMention);

  await targetUser.send(`⚠️ حصلت على تحذير بسيرفر **${ctx.guild.name}**\n**السبب:** ${reason}`).catch(() => null);
  await sendLog(ctx.guild, {
    title: '⚠️ تحذير عضو',
    color: 0xFEE75C,
    fields: [
      { name: 'العضو', value: `${targetUser.tag} (${targetUser.id})` },
      { name: 'بواسطة', value: byMention },
      { name: 'السبب', value: reason },
      { name: 'إجمالي تحذيراته', value: `${total}` },
    ],
  });
  return ctx.reply(`⚠️ تم تحذير ${targetUser} (إجمالي تحذيراته: ${total}).\n**السبب:** ${reason}`);
}

async function runAvatar(ctx, targetUser) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`صورة ${targetUser.username}`)
    .setImage(targetUser.displayAvatarURL({ size: 1024 }));
  return ctx.reply({ embeds: [embed] });
}

async function runUserInfo(ctx, targetUser) {
  const targetMember = await ctx.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) return ctx.reply('❌ ما لقيت هذا العضو بالسيرفر.');

  const roles = targetMember.roles.cache
    .filter(r => r.id !== ctx.guild.id)
    .sort((a, b) => b.position - a.position)
    .map(r => r.toString())
    .slice(0, 15);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`معلومات ${targetUser.username}`)
    .setThumbnail(targetUser.displayAvatarURL())
    .addFields(
      { name: 'الآيدي', value: targetUser.id, inline: true },
      { name: 'أعلى رتبة', value: targetMember.roles.highest.toString(), inline: true },
      { name: 'عدد الرتب', value: `${roles.length}`, inline: true },
      { name: 'تاريخ إنشاء الحساب', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:F>` },
      { name: 'تاريخ الانضمام للسيرفر', value: targetMember.joinedTimestamp ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:F>` : 'غير معروف' },
      { name: 'الرتب', value: roles.length ? roles.join(' ') : 'ماله رتب' },
    );

  return ctx.reply({ embeds: [embed] });
}

async function runServerInfo(ctx) {
  const guild = ctx.guild;
  const owner = await guild.fetchOwner().catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(guild.name)
    .setThumbnail(guild.iconURL() || null)
    .addFields(
      { name: 'الآيدي', value: guild.id, inline: true },
      { name: 'المالك', value: owner ? owner.user.tag : 'غير معروف', inline: true },
      { name: 'عدد الأعضاء', value: `${guild.memberCount}`, inline: true },
      { name: 'عدد الرتب', value: `${guild.roles.cache.size}`, inline: true },
      { name: 'عدد القنوات', value: `${guild.channels.cache.size}`, inline: true },
      { name: 'مستوى البوست', value: `${guild.premiumTier || 0} (${guild.premiumSubscriptionCount || 0} بوست)`, inline: true },
      { name: 'تاريخ الإنشاء', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>` },
    );

  return ctx.reply({ embeds: [embed] });
}

async function runBanList(ctx) {
  const bans = await ctx.guild.bans.fetch().catch(() => null);
  if (!bans || bans.size === 0) return ctx.reply('✅ ما فيه أي عضو محظور حاليًا.');

  const list = bans
    .map(b => `**${b.user.tag}** — \`${b.user.id}\`${b.reason ? ` — ${b.reason}` : ''}`)
    .slice(0, 20)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle(`قائمة المحظورين (${bans.size})`)
    .setDescription(list.length > 4000 ? list.slice(0, 4000) + '…' : list);

  return ctx.reply({ embeds: [embed] });
}

async function runUnban(ctx, userId) {
  if (!userId || !/^\d{15,25}$/.test(userId)) {
    return ctx.reply('❌ لازم تكتب آيدي صحيح (رقم فقط). تقدر تجيبه من `/قائمة_الحظر`.');
  }

  try {
    await ctx.guild.members.unban(userId);
    await sendLog(ctx.guild, {
      title: '✅ إلغاء حظر عضو',
      color: 0x57F287,
      fields: [
        { name: 'الآيدي', value: userId },
        { name: 'بواسطة', value: mentionExecutor(ctx) },
      ],
    });
    return ctx.reply(`✅ تم إلغاء حظر العضو صاحب الآيدي \`${userId}\`.`);
  } catch (err) {
    return ctx.reply('❌ ما قدرت ألغي الحظر — تأكد إن الآيدي صحيح وإن العضو محظور فعلاً.');
  }
}

// ============ تغيير اللقب ============
async function runSetNick(ctx, targetUser, nickname) {
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو.');
  const targetMember = await ctx.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) return ctx.reply('❌ ما لقيت هذا العضو بالسيرفر.');
  if (!targetMember.manageable) return ctx.reply('❌ ما أقدر أغيّر لقب هذا العضو (رتبته أعلى مني).');

  await targetMember.setNickname(nickname || null);
  await sendLog(ctx.guild, {
    title: '✏️ تغيير لقب عضو',
    color: 0x5865F2,
    fields: [
      { name: 'العضو', value: `${targetUser} (${targetUser.id})` },
      { name: 'بواسطة', value: mentionExecutor(ctx) },
      { name: 'اللقب الجديد', value: nickname || '(بدون لقب)' },
    ],
  });
  return ctx.reply(nickname
    ? `✏️ تم تغيير لقب ${targetUser} إلى **${nickname}**.`
    : `✏️ تم إزالة لقب ${targetUser}.`);
}

// ============ طرد صوتي ============
async function runVoiceKick(ctx, targetUser) {
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو.');
  const targetMember = await ctx.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) return ctx.reply('❌ ما لقيت هذا العضو بالسيرفر.');
  if (!targetMember.voice.channel) return ctx.reply('❌ هذا العضو مو موجود بروم صوتي حاليًا.');

  const fromChannel = targetMember.voice.channel;
  await targetMember.voice.disconnect();
  await sendLog(ctx.guild, {
    title: '🔇 طرد صوتي',
    color: 0xED4245,
    fields: [
      { name: 'العضو', value: `${targetUser}` },
      { name: 'الروم', value: `${fromChannel}` },
      { name: 'بواسطة', value: mentionExecutor(ctx) },
    ],
  });
  return ctx.reply(`🔇 تم طرد ${targetUser} من الروم الصوتي.`);
}

// ============ كتم/فك كتم المايك بالفويس ============
async function runVoiceMute(ctx, targetUser, mute) {
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو.');
  const targetMember = await ctx.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) return ctx.reply('❌ ما لقيت هذا العضو بالسيرفر.');
  if (!targetMember.voice.channel) return ctx.reply('❌ هذا العضو مو موجود بروم صوتي حاليًا.');

  await targetMember.voice.setMute(mute);
  await sendLog(ctx.guild, {
    title: mute ? '🔇 كتم مايك عضو' : '🔊 فك كتم مايك عضو',
    color: mute ? 0xFEE75C : 0x57F287,
    fields: [
      { name: 'العضو', value: `${targetUser}` },
      { name: 'بواسطة', value: mentionExecutor(ctx) },
    ],
  });
  return ctx.reply(mute ? `🔇 تم كتم مايك ${targetUser}.` : `🔊 تم فك كتم مايك ${targetUser}.`);
}

// ============ نقل عضو لروم صوتي ثاني ============
async function runMove(ctx, targetUser, channel) {
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو.');
  if (!channel || channel.type !== 2) return ctx.reply('❌ لازم تحدد روم صوتي صحيح.');

  const targetMember = await ctx.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) return ctx.reply('❌ ما لقيت هذا العضو بالسيرفر.');
  if (!targetMember.voice.channel) return ctx.reply('❌ هذا العضو مو موجود بروم صوتي حاليًا.');

  const fromChannel = targetMember.voice.channel;
  await targetMember.voice.setChannel(channel);
  await sendLog(ctx.guild, {
    title: '↔️ نقل عضو صوتي',
    color: 0x5865F2,
    fields: [
      { name: 'العضو', value: `${targetUser}` },
      { name: 'من', value: `${fromChannel}`, inline: true },
      { name: 'إلى', value: `${channel}`, inline: true },
      { name: 'بواسطة', value: mentionExecutor(ctx) },
    ],
  });
  return ctx.reply(`↔️ تم نقل ${targetUser} إلى ${channel}.`);
}

// ============ إضافة/إزالة رتبة ============
async function runRoleToggle(ctx, targetUser, role, action) {
  if (!targetUser || !role) return ctx.reply('❌ لازم تحدد العضو والرتبة.');
  const targetMember = await ctx.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) return ctx.reply('❌ ما لقيت هذا العضو بالسيرفر.');

  const botHighest = ctx.guild.members.me.roles.highest;
  if (role.position >= botHighest.position) {
    return ctx.reply('❌ ما أقدر أتحكم بهذي الرتبة (أعلى من رتبة البوت أو مساوية لها).');
  }

  if (action === 'add') {
    if (targetMember.roles.cache.has(role.id)) return ctx.reply('❌ العضو عنده هذي الرتبة أصلاً.');
    await targetMember.roles.add(role);
    await sendLog(ctx.guild, {
      title: '🎭 إعطاء رول',
      color: 0x5865F2,
      fields: [
        { name: 'العضو', value: `${targetUser}` },
        { name: 'الرول', value: `${role}` },
        { name: 'بواسطة', value: mentionExecutor(ctx) },
      ],
    });
    return ctx.reply(`✅ تم إعطاء ${targetUser} رتبة ${role}.`);
  } else {
    if (!targetMember.roles.cache.has(role.id)) return ctx.reply('❌ العضو ماله هذي الرتبة أصلاً.');
    await targetMember.roles.remove(role);
    await sendLog(ctx.guild, {
      title: '🎭 إزالة رول',
      color: 0xED4245,
      fields: [
        { name: 'العضو', value: `${targetUser}` },
        { name: 'الرول', value: `${role}` },
        { name: 'بواسطة', value: mentionExecutor(ctx) },
      ],
    });
    return ctx.reply(`✅ تم إزالة رتبة ${role} من ${targetUser}.`);
  }
}

// ============ نظام النقاط ============
async function runPoints(ctx, targetUser, action, amount) {
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو.');

  if (action === 'show') {
    const current = store.getPoints(ctx.guild.id, targetUser.id);
    return ctx.reply(`⭐ نقاط ${targetUser}: **${current}**`);
  }

  if (amount === null || amount === undefined || isNaN(amount)) {
    return ctx.reply('❌ لازم تحدد عدد النقاط.');
  }

  let newTotal;
  if (action === 'add') newTotal = store.addPoints(ctx.guild.id, targetUser.id, amount);
  else if (action === 'remove') newTotal = store.addPoints(ctx.guild.id, targetUser.id, -amount);
  else if (action === 'set') newTotal = store.setPoints(ctx.guild.id, targetUser.id, amount);
  else return ctx.reply('❌ إجراء غير معروف.');

  await sendLog(ctx.guild, {
    title: '⭐ تعديل نقاط',
    color: 0xFEE75C,
    fields: [
      { name: 'العضو', value: `${targetUser} (${targetUser.id})` },
      { name: 'بواسطة', value: ctx.executorId ? `<@${ctx.executorId}>` : 'غير معروف' },
      { name: 'الإجراء', value: action === 'add' ? `+${amount}` : action === 'remove' ? `-${amount}` : `تعيين إلى ${amount}` },
      { name: 'الرصيد الجديد', value: `${newTotal}` },
    ],
  });

  return ctx.reply(`⭐ رصيد ${targetUser} الحالي: **${newTotal}** نقطة.`);
}

// ============ عرض/حذف التحذيرات ============
async function runWarnings(ctx, targetUser) {
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو.');
  const warnings = store.getWarnings(ctx.guild.id, targetUser.id);
  if (!warnings.length) return ctx.reply(`✅ ${targetUser} ماله أي تحذيرات.`);

  const list = warnings
    .map((w, i) => `**${i + 1}.** ${w.reason} — بواسطة ${w.by} (<t:${Math.floor(new Date(w.date).getTime() / 1000)}:R>)`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle(`تحذيرات ${targetUser.tag} (${warnings.length})`)
    .setDescription(list);

  return ctx.reply({ embeds: [embed] });
}

async function runWarnRemove(ctx, targetUser, index) {
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو.');
  const success = store.removeWarning(ctx.guild.id, targetUser.id, index);
  if (!success) return ctx.reply('❌ ما لقيت هذا التحذير — تأكد من الرقم عن طريق `/تحذيرات`.');

  await sendLog(ctx.guild, {
    title: '🗑️ حذف تحذير',
    color: 0x57F287,
    fields: [
      { name: 'العضو', value: `${targetUser} (${targetUser.id})` },
      { name: 'بواسطة', value: mentionExecutor(ctx) },
      { name: 'التفاصيل', value: index ? `حذف التحذير رقم ${index}` : 'حذف كل التحذيرات' },
    ],
  });

  return ctx.reply(index
    ? `✅ تم حذف التحذير رقم ${index} من ${targetUser}.`
    : `✅ تم حذف كل تحذيرات ${targetUser}.`);
}

// ============ شيل: يشيل عدد معيّن من تحذيرات عضو (الأحدث أولًا) ============
async function runWarnShift(ctx, targetUser, count) {
  if (!targetUser) return ctx.reply('❌ لازم تحدد العضو.');
  count = count && count > 0 ? count : 1; // بدون رقم = يشيل تحذير وحد بس

  const { removed, remaining } = store.removeWarningsCount(ctx.guild.id, targetUser.id, count);
  if (removed === 0) return ctx.reply(`✅ ${targetUser} ماله أي تحذيرات أصلاً.`);

  await sendLog(ctx.guild, {
    title: '🗑️ إزالة تحذيرات',
    color: 0x57F287,
    fields: [
      { name: 'العضو', value: `${targetUser} (${targetUser.id})` },
      { name: 'بواسطة', value: mentionExecutor(ctx) },
      { name: 'العدد المُزال', value: `${removed}` },
      { name: 'المتبقي', value: `${remaining}` },
    ],
  });

  return ctx.reply(`✅ تم إزالة ${removed} تحذير من ${targetUser} (المتبقي: ${remaining}).`);
}

// ============ قفل/فتح روم ============
async function runLock(ctx, lock) {
  const channel = ctx.channel;
  await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: lock ? false : null });

  await sendLog(ctx.guild, {
    title: lock ? '🔒 قفل روم' : '🔓 فتح روم',
    color: lock ? 0xED4245 : 0x57F287,
    fields: [
      { name: 'الروم', value: `${channel}` },
      { name: 'بواسطة', value: ctx.executorId ? `<@${ctx.executorId}>` : 'غير معروف' },
    ],
  });

  return ctx.reply(lock ? `🔒 تم قفل ${channel} — الجميع ما يقدر يكتب.` : `🔓 تم فتح ${channel} — الجميع يقدر يكتب.`);
}

// ============ تغيير لون رتبة ============
async function runSetColor(ctx, role, hexColor) {
  if (!role) return ctx.reply('❌ لازم تحدد الرتبة.');
  if (!/^#?[0-9A-Fa-f]{6}$/.test(hexColor)) {
    return ctx.reply('❌ صيغة اللون غير صحيحة. اكتبها مثل: #FFD700');
  }

  const color = hexColor.startsWith('#') ? hexColor : `#${hexColor}`;

  const botHighest = ctx.guild.members.me.roles.highest;
  if (role.position >= botHighest.position) {
    return ctx.reply('❌ ما أقدر أعدّل هذي الرتبة (أعلى من رتبة البوت أو مساوية لها).');
  }

  await role.setColor(color);
  await sendLog(ctx.guild, {
    title: '🎨 تغيير لون رتبة',
    color: parseInt(color.replace('#', ''), 16),
    fields: [
      { name: 'الرتبة', value: `${role}` },
      { name: 'اللون الجديد', value: color },
      { name: 'بواسطة', value: ctx.executorId ? `<@${ctx.executorId}>` : 'غير معروف' },
    ],
  });

  return ctx.reply(`🎨 تم تغيير لون رتبة ${role} إلى ${color}.`);
}

// ============ سلو مود ============
async function runSlowmode(ctx, seconds) {
  const channel = ctx.channel;
  await channel.setRateLimitPerUser(seconds);

  await sendLog(ctx.guild, {
    title: seconds > 0 ? '🐢 تفعيل سلو مود' : '⚡ تعطيل سلو مود',
    color: seconds > 0 ? 0xFEE75C : 0x57F287,
    fields: [
      { name: 'الروم', value: `${channel}` },
      { name: 'المدة', value: seconds > 0 ? `${seconds} ثانية` : 'معطّل' },
      { name: 'بواسطة', value: ctx.executorId ? `<@${ctx.executorId}>` : 'غير معروف' },
    ],
  });

  return ctx.reply(seconds > 0
    ? `🐢 تم تفعيل السلو مود بـ${channel} — ${seconds} ثانية بين كل رسالة.`
    : `⚡ تم تعطيل السلو مود بـ${channel}.`);
}

// ============ تصفير نقاط/تحذيرات ============
async function runReset(ctx, type, targetUser) {
  const scope = targetUser ? `${targetUser}` : 'كل أعضاء السيرفر';

  if (type === 'points' || type === 'all') store.resetPoints(ctx.guild.id, targetUser?.id);
  if (type === 'warnings' || type === 'all') store.resetWarnings(ctx.guild.id, targetUser?.id);

  await sendLog(ctx.guild, {
    title: '♻️ تصفير بيانات',
    color: 0xED4245,
    fields: [
      { name: 'النوع', value: type === 'points' ? 'نقاط' : type === 'warnings' ? 'تحذيرات' : 'الكل' },
      { name: 'النطاق', value: scope },
      { name: 'بواسطة', value: ctx.executorId ? `<@${ctx.executorId}>` : 'غير معروف' },
    ],
  });

  return ctx.reply(`♻️ تم التصفير لـ ${scope}.`);
}

// ============ إدارة الكلمات الممنوعة (AutoMod) ============
async function runAddBannedWord(ctx, word) {
  if (!word) return ctx.reply('❌ لازم تكتب الكلمة.');
  const added = store.addBannedWord(ctx.guild.id, word);
  if (!added) return ctx.reply('❌ هذي الكلمة موجودة بالقائمة أصلاً.');

  await sendLog(ctx.guild, {
    title: '➕ إضافة كلمة ممنوعة',
    color: 0x57F287,
    fields: [
      { name: 'الكلمة', value: `||${word}||` },
      { name: 'بواسطة', value: mentionExecutor(ctx) },
    ],
  });
  return ctx.reply(`✅ تمت إضافة الكلمة لقائمة الكلمات الممنوعة.`);
}

async function runRemoveBannedWord(ctx, word) {
  if (!word) return ctx.reply('❌ لازم تكتب الكلمة.');
  const removed = store.removeBannedWord(ctx.guild.id, word);
  if (!removed) return ctx.reply('❌ هذي الكلمة مو موجودة بالقائمة.');

  await sendLog(ctx.guild, {
    title: '➖ حذف كلمة ممنوعة',
    color: 0x57F287,
    fields: [
      { name: 'الكلمة', value: `||${word}||` },
      { name: 'بواسطة', value: mentionExecutor(ctx) },
    ],
  });
  return ctx.reply(`✅ تم حذف الكلمة من القائمة.`);
}

async function runListBannedWords(ctx) {
  const words = store.getBannedWords(ctx.guild.id);
  if (!words.length) return ctx.reply('✅ ما فيه أي كلمات ممنوعة مضافة حاليًا.');

  const embed = new EmbedBuilder()
    .setColor(0xC9A227)
    .setTitle(`الكلمات الممنوعة (${words.length})`)
    .setDescription(words.map(w => `||${w}||`).join(', '));

  return ctx.reply({ embeds: [embed] });
}

// ============ صلاحيات مطلوبة لكل أمر نصي (لا يشتغل الأمر إلا لمن يملكها) ============
const REQUIRED_PERMS = {
  مسح: PermissionsBitField.Flags.Administrator,
  تايم: PermissionsBitField.Flags.Administrator,
  فك_تايم: PermissionsBitField.Flags.Administrator,
  طرد: PermissionsBitField.Flags.Administrator,
  حظر: PermissionsBitField.Flags.Administrator, // + تحقق إضافي: بس المالك (شوف isOwnerOnly تحت)
  تحذير: PermissionsBitField.Flags.Administrator,
  تح: PermissionsBitField.Flags.Administrator,
  قائمة_الحظر: PermissionsBitField.Flags.Administrator,
  الغاء_حظر: PermissionsBitField.Flags.Administrator,
  لقب: PermissionsBitField.Flags.Administrator,
  طرد_صوت: PermissionsBitField.Flags.Administrator,
  كتم_صوت: PermissionsBitField.Flags.Administrator,
  فك_كتم_صوت: PermissionsBitField.Flags.Administrator,
  نقل: PermissionsBitField.Flags.Administrator,
  رول: PermissionsBitField.Flags.Administrator,
  نقاط: PermissionsBitField.Flags.Administrator,
  حذف_تحذير: PermissionsBitField.Flags.Administrator,
  شيل: PermissionsBitField.Flags.Administrator,
  تحذيرات: PermissionsBitField.Flags.Administrator,
  ق: PermissionsBitField.Flags.Administrator,
  ف: PermissionsBitField.Flags.Administrator,
  لون_الرتبة: PermissionsBitField.Flags.Administrator,
  سلو_مود: PermissionsBitField.Flags.Administrator,
  تصفير: PermissionsBitField.Flags.Administrator,
  اضافة_كلمة: PermissionsBitField.Flags.Administrator,
  حذف_كلمة: PermissionsBitField.Flags.Administrator,
  كلمات_ممنوعة: PermissionsBitField.Flags.Administrator,
};

// أوامر يجب أن يكون منفذها مالك السيرفر فعليًا (مو بس أدمن)
const OWNER_ONLY_COMMANDS = ['حظر'];

// أوامر معلومات — أي عضو يقدر يستخدمها بدون صلاحيات خاصة
const OPEN_TEXT_COMMANDS = ['افتار', 'معلومات_عضو', 'معلومات_السيرفر', 's'];

// ============ Slash Commands ============
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const ctx = {
    guild: interaction.guild,
    channel: interaction.channel,
    executorId: interaction.user.id,
    reply: (content) => interaction.reply(content),
    // رد يمسح نفسه تلقائيًا بعد فترة (يُستخدم لتأكيد أوامر زي مسح)
    replyTemp: async (content, ms = 5000) => {
      await interaction.reply(content);
      setTimeout(() => interaction.deleteReply().catch(() => {}), ms);
    },
  };

  try {
    switch (interaction.commandName) {
      case 'مسح':
        return await runClear(ctx, interaction.options.getInteger('عدد'));
      case 'تايم':
        return await runMute(
          ctx,
          interaction.options.getUser('العضو'),
          interaction.options.getString('المدة'),
          interaction.options.getString('السبب')
        );
      case 'فك_تايم':
        return await runUnmute(ctx, interaction.options.getUser('العضو'));
      case 'طرد':
        return await runKick(ctx, interaction.options.getUser('العضو'), interaction.options.getString('السبب'));
      case 'حظر':
        return await runBan(ctx, interaction.options.getUser('العضو'), interaction.options.getString('السبب'));
      case 'تحذير':
        return await runWarn(ctx, interaction.options.getUser('العضو'), interaction.options.getString('السبب'));
      case 'افتار':
        return await runAvatar(ctx, interaction.options.getUser('العضو') || interaction.user);
      case 'معلومات_عضو':
        return await runUserInfo(ctx, interaction.options.getUser('العضو') || interaction.user);
      case 'معلومات_السيرفر':
        return await runServerInfo(ctx);
      case 'قائمة_الحظر':
        return await runBanList(ctx);
      case 'الغاء_حظر':
        return await runUnban(ctx, interaction.options.getString('الايدي'));
      case 'لقب':
        return await runSetNick(ctx, interaction.options.getUser('العضو'), interaction.options.getString('اللقب'));
      case 'طرد_صوت':
        return await runVoiceKick(ctx, interaction.options.getUser('العضو'));
      case 'كتم_صوت':
        return await runVoiceMute(ctx, interaction.options.getUser('العضو'), true);
      case 'فك_كتم_صوت':
        return await runVoiceMute(ctx, interaction.options.getUser('العضو'), false);
      case 'نقل':
        return await runMove(ctx, interaction.options.getUser('العضو'), interaction.options.getChannel('الروم'));
      case 'رول':
        return await runRoleToggle(ctx, interaction.options.getUser('العضو'), interaction.options.getRole('الرتبة'), interaction.options.getString('الاجراء'));
      case 'نقاط':
        return await runPoints(ctx, interaction.options.getUser('العضو'), interaction.options.getString('الاجراء'), interaction.options.getInteger('العدد'));
      case 'حذف_تحذير':
        return await runWarnRemove(ctx, interaction.options.getUser('العضو'), interaction.options.getInteger('الرقم'));
      case 'شيل':
        return await runWarnShift(ctx, interaction.options.getUser('العضو'), interaction.options.getInteger('العدد'));
      case 'تحذيرات':
        return await runWarnings(ctx, interaction.options.getUser('العضو') || interaction.user);
      case 'ق':
        return await runLock(ctx, true);
      case 'ف':
        return await runLock(ctx, false);
      case 'لون_الرتبة':
        return await runSetColor(ctx, interaction.options.getRole('الرتبة'), interaction.options.getString('اللون'));
      case 'سلو_مود':
        return await runSlowmode(ctx, interaction.options.getInteger('الثواني'));
      case 'تصفير':
        return await runReset(ctx, interaction.options.getString('النوع'), interaction.options.getUser('العضو'));
      case 'اضافة_كلمة':
        return await runAddBannedWord(ctx, interaction.options.getString('الكلمة'));
      case 'حذف_كلمة':
        return await runRemoveBannedWord(ctx, interaction.options.getString('الكلمة'));
      case 'كلمات_ممنوعة':
        return await runListBannedWords(ctx);
    }
  } catch (err) {
    console.error(err);
    const msg = { content: '❌ صار خطأ أثناء تنفيذ الأمر.', ephemeral: true };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
      else await interaction.reply(msg);
    } catch (e) {
      console.error('فشل إرسال رسالة الخطأ نفسها:', e);
    }
  }
});

// ============ أوامر نصية عادية بدون / (مثال: "مسح 10") ============
// ==================================================================
// AutoMod: فلتر كلمات ممنوعة + منع روابط دعوات سيرفرات ديسكورد ثانية
// يرجع true لو حذف الرسالة (يعني نوقف أي معالجة إضافية لها)
// ==================================================================
const INVITE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-zA-Z0-9-]+)/i;

async function runAutoMod(message) {
  // الأدمن ستريتر مستثنى من الفلتر
  if (message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return false;

  const content = message.content;
  const lower = content.toLowerCase();

  // --- 1) روابط دعوات ديسكورد ثانية ---
  const inviteMatch = content.match(INVITE_REGEX);
  if (inviteMatch) {
    let belongsToThisGuild = false;
    try {
      const invite = await message.client.fetchInvite(inviteMatch[1]);
      belongsToThisGuild = invite.guild?.id === message.guild.id;
    } catch {
      belongsToThisGuild = false; // ما قدرنا نتحقق = نتعامل معه كرابط خارجي
    }

    if (!belongsToThisGuild) {
      await message.delete().catch(() => null);
      const notice = await message.channel.send(`🚫 ${message.author}، ما يُسمح بروابط دعوات سيرفرات ثانية هنا.`).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), 5000);

      await sendLog(message.guild, {
        title: '🚫 AutoMod: رابط دعوة ممنوع',
        color: 0xED4245,
        fields: [
          { name: 'العضو', value: `${message.author} (${message.author.id})` },
          { name: 'الروم', value: `${message.channel}` },
          { name: 'المحتوى', value: content.slice(0, 500) },
        ],
      });
      return true;
    }
  }

  // --- 2) فلتر الكلمات الممنوعة ---
  const bannedWords = store.getBannedWords(message.guild.id);
  const matchedWord = bannedWords.find(w => lower.includes(w));
  if (matchedWord) {
    await message.delete().catch(() => null);
    const notice = await message.channel.send(`🚫 ${message.author}، رسالتك فيها كلمة غير مسموحة.`).catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 5000);

    await sendLog(message.guild, {
      title: '🚫 AutoMod: كلمة ممنوعة',
      color: 0xED4245,
      fields: [
        { name: 'العضو', value: `${message.author} (${message.author.id})` },
        { name: 'الروم', value: `${message.channel}` },
        { name: 'المحتوى', value: content.slice(0, 500) },
      ],
    });
    return true;
  }

  return false;
}

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  // ============ AutoMod: فلتر كلمات + منع روابط دعوات ديسكورد ثانية ============
  const handledByAutoMod = await runAutoMod(message);
  if (handledByAutoMod) return; // الرسالة انحذفت، ما نكمل معالجتها كأمر

  const parts = message.content.trim().split(/\s+/);
  const command = parts[0];

  const isModCommand = Object.keys(REQUIRED_PERMS).includes(command);
  const isOpenCommand = OPEN_TEXT_COMMANDS.includes(command);
  if (!isModCommand && !isOpenCommand) return; // مو أمر نتعرف عليه، تجاهل

  if (isModCommand && !message.member.permissions.has(REQUIRED_PERMS[command])) {
    return message.reply('❌ ما عندك صلاحية تنفّذ هذا الأمر.');
  }

  const ctx = {
    guild: message.guild,
    channel: message.channel,
    executorId: message.author.id,
    reply: async (content) => {
      try {
        await message.reply(content);
      } catch {
        await message.channel.send(content).catch(() => null);
      }
    },
    // رد يمسح نفسه تلقائيًا بعد فترة (يُستخدم لتأكيد أوامر زي مسح)
    replyTemp: async (content, ms = 5000) => {
      let sent;
      try {
        sent = await message.reply(content);
      } catch {
        sent = await message.channel.send(content).catch(() => null);
      }
      if (sent) setTimeout(() => sent.delete().catch(() => {}), ms);
    },
  };

  const mentionedUser = message.mentions.users.first();
  const mentionedRole = message.mentions.roles.first();
  const mentionedChannel = message.mentions.channels.first();
  const rest = parts.slice(1).filter(p => !p.startsWith('<@') && !p.startsWith('<#'));

  try {
    switch (command) {
      case 'مسح': {
        const amount = parts[1] ? parseInt(parts[1], 10) : null;
        return await runClear(ctx, amount);
      }
      case 'تايم': {
        const duration = rest[0];
        const reason = rest.slice(1).join(' ');
        return await runMute(ctx, mentionedUser, duration, reason);
      }
      case 'فك_تايم':
        return await runUnmute(ctx, mentionedUser);
      case 'طرد':
        return await runKick(ctx, mentionedUser, rest.join(' '));
      case 'حظر':
        return await runBan(ctx, mentionedUser, rest.join(' '));
      case 'تحذير':
      case 'تح':
        return await runWarn(ctx, mentionedUser, rest.join(' '));
      case 'قائمة_الحظر':
        return await runBanList(ctx);
      case 'الغاء_حظر':
        return await runUnban(ctx, parts[1]);
      case 'افتار':
        return await runAvatar(ctx, mentionedUser || message.author);
      case 'معلومات_عضو':
        return await runUserInfo(ctx, mentionedUser || message.author);
      case 'معلومات_السيرفر':
      case 's':
        return await runServerInfo(ctx);
      case 'لقب':
        return await runSetNick(ctx, mentionedUser, rest.join(' '));
      case 'طرد_صوت':
        return await runVoiceKick(ctx, mentionedUser);
      case 'كتم_صوت':
        return await runVoiceMute(ctx, mentionedUser, true);
      case 'فك_كتم_صوت':
        return await runVoiceMute(ctx, mentionedUser, false);
      case 'نقل':
        return await runMove(ctx, mentionedUser, mentionedChannel);
      case 'رول': {
        // الصيغة: رول @شخص <منشن الرتبة أو آيديها أو اسمها بالضبط> <اضافة/ازالة>
        const actionWords = { اضافة: 'add', إضافة: 'add', ازالة: 'remove', إزالة: 'remove' };
        let action = 'add';
        const remaining = [...rest];
        const actionIdx = remaining.findIndex(w => actionWords[w]);
        if (actionIdx !== -1) {
          action = actionWords[remaining[actionIdx]];
          remaining.splice(actionIdx, 1);
        }

        let role = mentionedRole;
        const roleIdentifier = remaining.join(' ').trim();
        if (!role && roleIdentifier) {
          if (/^\d{15,25}$/.test(roleIdentifier)) {
            role = message.guild.roles.cache.get(roleIdentifier);
          } else {
            role = message.guild.roles.cache.find(r => r.name === roleIdentifier)
              || message.guild.roles.cache.find(r => r.name.toLowerCase() === roleIdentifier.toLowerCase());
          }
        }
        if (!role) return ctx.reply('❌ ما لقيت الرول — تأكد من الآيدي أو الاسم بالضبط (أو منشنه بـ @).');

        return await runRoleToggle(ctx, mentionedUser, role, action);
      }
      case 'نقاط': {
        // نقاط @شخص اضافة 10  /  نقاط @شخص سحب 5  /  نقاط @شخص تعيين 0  /  نقاط @شخص عرض
        const actionMap = { اضافة: 'add', إضافة: 'add', سحب: 'remove', تعيين: 'set', عرض: 'show' };
        const action = actionMap[rest[0]];
        const amount = rest[1] ? parseInt(rest[1], 10) : null;
        if (!action) return ctx.reply('❌ الصيغة: نقاط @شخص [اضافة/سحب/تعيين/عرض] [العدد]');
        return await runPoints(ctx, mentionedUser, action, amount);
      }
      case 'حذف_تحذير': {
        const index = parts[2] ? parseInt(parts[2], 10) : null;
        return await runWarnRemove(ctx, mentionedUser, index);
      }
      case 'شيل': {
        const count = parts[2] ? parseInt(parts[2], 10) : 1;
        return await runWarnShift(ctx, mentionedUser, count);
      }
      case 'تحذيرات':
        return await runWarnings(ctx, mentionedUser || message.author);
      case 'ق':
        return await runLock(ctx, true);
      case 'ف':
        return await runLock(ctx, false);
      case 'لون_الرتبة':
        return await runSetColor(ctx, mentionedRole, rest.filter(p => !p.startsWith('<@&'))[0]);
      case 'سلو_مود':
        return await runSlowmode(ctx, parseInt(parts[1], 10) || 0);
      case 'تصفير': {
        const typeMap = { نقاط: 'points', تحذيرات: 'warnings', الكل: 'all' };
        const type = typeMap[parts[1]];
        if (!type) return ctx.reply('❌ الصيغة: تصفير [نقاط/تحذيرات/الكل] [@شخص اختياري]');
        return await runReset(ctx, type, mentionedUser);
      }
      case 'اضافة_كلمة':
        return await runAddBannedWord(ctx, parts.slice(1).join(' '));
      case 'حذف_كلمة':
        return await runRemoveBannedWord(ctx, parts.slice(1).join(' '));
      case 'كلمات_ممنوعة':
        return await runListBannedWords(ctx);
    }
  } catch (err) {
    console.error(err);
    return message.reply('❌ صار خطأ أثناء تنفيذ الأمر.');
  }
});

// ============ سيرفر HTTP بسيط جدًا ============
// بعض منصات الاستضافة المجانية (مثل Render) تحتاج البرنامج يستمع على بورت HTTP
// عشان تعتبره "شغال" وما تطفيه. هذا ما له علاقة بمنطق البوت، بس ضروري للاستضافة.
const http = require('http');
const PORT = process.env.PORT || 3000;
const keepAliveServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('البوت شغال ✅');
});

keepAliveServer.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`⚠️ البورت ${PORT} محجوز (يمكن فيه نسخة ثانية من البوت شغالة) — تجاهلت سيرفر الفحص، البوت نفسه بيشتغل عادي.`);
  } else {
    console.error('خطأ بسيرفر الفحص:', err);
  }
});

keepAliveServer.listen(PORT, '0.0.0.0', () => console.log(`🌐 سيرفر الفحص شغال على بورت ${PORT}`));

client.login(process.env.DISCORD_TOKEN);
