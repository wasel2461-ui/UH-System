// هذا الملف يسجل الأوامر (Slash Commands) على السيرفر تبعك بأسماء عربية
// شغّله مرة وحدة فقط (أو كل ما تعدّل الأوامر): node deploy-commands.js

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('مسح')
    .setDescription('حذف رسائل بالقناة (اتركه فاضي لحذف أكبر عدد ممكن دفعة وحدة)')
    .addIntegerOption(option =>
      option.setName('عدد')
        .setDescription('عدد الرسائل المراد حذفها (1-100) — اتركه فاضي لحذف 100')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100))
    .setDefaultMemberPermissions('8') // Administrator
    .toJSON(),

  new SlashCommandBuilder()
    .setName('تايم')
    .setDescription('كتم عضو لمدة معينة (Timeout)')
    .addUserOption(option =>
      option.setName('العضو')
        .setDescription('العضو المراد كتمه')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('المدة')
        .setDescription('مثال: 30m (30 دقيقة) أو 1h (ساعة) أو 2d (يومين)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('السبب')
        .setDescription('سبب الكتم (اختياري)')
        .setRequired(false))
    .setDefaultMemberPermissions('8') // Administrator
    .toJSON(),

  new SlashCommandBuilder()
    .setName('فك_تايم')
    .setDescription('إلغاء كتم عضو (إزالة Timeout)')
    .addUserOption(option =>
      option.setName('العضو')
        .setDescription('العضو المراد إلغاء كتمه')
        .setRequired(true))
    .setDefaultMemberPermissions('8') // Administrator
    .toJSON(),

  new SlashCommandBuilder()
    .setName('طرد')
    .setDescription('طرد عضو من السيرفر')
    .addUserOption(option =>
      option.setName('العضو')
        .setDescription('العضو المراد طرده')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('السبب')
        .setDescription('سبب الطرد (اختياري)')
        .setRequired(false))
    .setDefaultMemberPermissions('8') // Administrator
    .toJSON(),

  new SlashCommandBuilder()
    .setName('حظر')
    .setDescription('حظر عضو من السيرفر')
    .addUserOption(option =>
      option.setName('العضو')
        .setDescription('العضو المراد حظره')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('السبب')
        .setDescription('سبب الحظر (اختياري)')
        .setRequired(false))
    .setDefaultMemberPermissions('8') // Administrator
    .toJSON(),

  new SlashCommandBuilder()
    .setName('تحذير')
    .setDescription('إعطاء تحذير لعضو (يُرسَل له بالخاص)')
    .addUserOption(option =>
      option.setName('العضو')
        .setDescription('العضو المراد تحذيره')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('السبب')
        .setDescription('سبب التحذير')
        .setRequired(true))
    .setDefaultMemberPermissions('8') // Administrator
    .toJSON(),

  new SlashCommandBuilder()
    .setName('افتار')
    .setDescription('عرض صورة عضو بحجم كبير')
    .addUserOption(option =>
      option.setName('العضو')
        .setDescription('العضو (اتركه فاضي لعرض صورتك انت)')
        .setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('معلومات_عضو')
    .setDescription('عرض معلومات عن عضو بالسيرفر')
    .addUserOption(option =>
      option.setName('العضو')
        .setDescription('العضو (اتركه فاضي لعرض معلوماتك انت)')
        .setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('معلومات_السيرفر')
    .setDescription('عرض معلومات عن السيرفر')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('قائمة_الحظر')
    .setDescription('عرض قائمة الأعضاء المحظورين بالسيرفر')
    .setDefaultMemberPermissions('8') // Administrator
    .toJSON(),

  new SlashCommandBuilder()
    .setName('الغاء_حظر')
    .setDescription('إلغاء حظر عضو باستخدام الآيدي تبعه')
    .addStringOption(option =>
      option.setName('الايدي')
        .setDescription('آيدي العضو (User ID) المراد إلغاء حظره')
        .setRequired(true))
    .setDefaultMemberPermissions('8') // Administrator
    .toJSON(),

  new SlashCommandBuilder()
    .setName('لقب')
    .setDescription('تغيير لقب (نيك نيم) عضو')
    .addUserOption(option => option.setName('العضو').setDescription('العضو').setRequired(true))
    .addStringOption(option => option.setName('اللقب').setDescription('اللقب الجديد (اتركه فاضي لإزالة اللقب)').setRequired(false))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('طرد_صوت')
    .setDescription('طرد عضو من الروم الصوتي (بدون طرده من السيرفر)')
    .addUserOption(option => option.setName('العضو').setDescription('العضو').setRequired(true))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('كتم_صوت')
    .setDescription('كتم مايك عضو بالروم الصوتي (بدون كتمه بالكتابة)')
    .addUserOption(option => option.setName('العضو').setDescription('العضو').setRequired(true))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('فك_كتم_صوت')
    .setDescription('إلغاء كتم مايك عضو بالروم الصوتي')
    .addUserOption(option => option.setName('العضو').setDescription('العضو').setRequired(true))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('نقل')
    .setDescription('نقل عضو لروم صوتي ثاني')
    .addUserOption(option => option.setName('العضو').setDescription('العضو').setRequired(true))
    .addChannelOption(option => option.setName('الروم').setDescription('الروم الصوتي المراد النقل له').setRequired(true).addChannelTypes(ChannelType.GuildVoice))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('رول')
    .setDescription('إضافة أو إزالة رتبة من عضو')
    .addUserOption(option => option.setName('العضو').setDescription('العضو').setRequired(true))
    .addRoleOption(option => option.setName('الرتبة').setDescription('الرتبة').setRequired(true))
    .addStringOption(option =>
      option.setName('الاجراء')
        .setDescription('اضافة أو إزالة')
        .setRequired(true)
        .addChoices({ name: 'إضافة', value: 'add' }, { name: 'إزالة', value: 'remove' }))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('نقاط')
    .setDescription('إدارة نقاط عضو')
    .addUserOption(option => option.setName('العضو').setDescription('العضو').setRequired(true))
    .addStringOption(option =>
      option.setName('الاجراء')
        .setDescription('العملية المطلوبة')
        .setRequired(true)
        .addChoices(
          { name: 'إضافة', value: 'add' },
          { name: 'سحب', value: 'remove' },
          { name: 'تعيين', value: 'set' },
          { name: 'عرض', value: 'show' },
        ))
    .addIntegerOption(option => option.setName('العدد').setDescription('عدد النقاط (غير مطلوب لخيار العرض)').setRequired(false))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('حذف_تحذير')
    .setDescription('حذف تحذير معين لعضو (أو كل تحذيراته)')
    .addUserOption(option => option.setName('العضو').setDescription('العضو').setRequired(true))
    .addIntegerOption(option => option.setName('الرقم').setDescription('رقم التحذير من /تحذيرات (اتركه فاضي لحذف الكل)').setRequired(false))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('شيل')
    .setDescription('يشيل عدد معيّن من تحذيرات عضو (الأحدث أولًا)')
    .addUserOption(option => option.setName('العضو').setDescription('العضو').setRequired(true))
    .addIntegerOption(option => option.setName('العدد').setDescription('عدد التحذيرات المراد إزالتها (افتراضي: 1)').setRequired(false).setMinValue(1))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('تحذيرات')
    .setDescription('عرض تحذيراتك أو تحذيرات عضو معيّن')
    .addUserOption(option => option.setName('العضو').setDescription('اتركه فاضي لعرض تحذيراتك انت').setRequired(false))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('ق')
    .setDescription('تعطيل إرسال الرسائل بالروم الحالي للجميع')
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('ف')
    .setDescription('السماح بإرسال الرسائل بالروم الحالي للجميع')
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('لون_الرتبة')
    .setDescription('تغيير لون رتبة عن طريق Hex Code')
    .addRoleOption(option => option.setName('الرتبة').setDescription('الرتبة').setRequired(true))
    .addStringOption(option => option.setName('اللون').setDescription('كود اللون Hex مثل #FFD700').setRequired(true))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('سلو_مود')
    .setDescription('تفعيل أو تعطيل السلو مود بالروم الحالي')
    .addIntegerOption(option => option.setName('الثواني').setDescription('عدد الثواني بين كل رسالة (0 = تعطيل)').setRequired(true).setMinValue(0).setMaxValue(21600))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('تصفير')
    .setDescription('تصفير نقاط أو تحذيرات عضو (أو الجميع)')
    .addStringOption(option =>
      option.setName('النوع')
        .setDescription('وش تبي تصفّر')
        .setRequired(true)
        .addChoices({ name: 'نقاط', value: 'points' }, { name: 'تحذيرات', value: 'warnings' }, { name: 'الكل', value: 'all' }))
    .addUserOption(option => option.setName('العضو').setDescription('اتركه فاضي لتصفير الجميع بالسيرفر').setRequired(false))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('اضافة_كلمة')
    .setDescription('إضافة كلمة لقائمة الكلمات الممنوعة (AutoMod)')
    .addStringOption(option => option.setName('الكلمة').setDescription('الكلمة المراد منعها').setRequired(true))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('حذف_كلمة')
    .setDescription('حذف كلمة من قائمة الكلمات الممنوعة')
    .addStringOption(option => option.setName('الكلمة').setDescription('الكلمة المراد حذفها من القائمة').setRequired(true))
    .setDefaultMemberPermissions('8')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('كلمات_ممنوعة')
    .setDescription('عرض كل الكلمات الممنوعة حاليًا')
    .setDefaultMemberPermissions('8')
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('جاري تسجيل الأوامر...');

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands },
    );

    console.log('✅ تم تسجيل الأوامر بنجاح على السيرفر.');
  } catch (error) {
    console.error(error);
  }
})();
