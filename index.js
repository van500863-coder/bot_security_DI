require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const path = require('path');
const axios = require('axios');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// ==========================================
// ផ្នែកទី១៖ ភ្ជាប់ជាមួយ Firebase
// ==========================================
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : ''
};

try { 
    initializeApp({ credential: cert(serviceAccount) }); 
    console.log("✅ Firebase connected successfully!"); 
} catch (e) { 
    console.error("❌ Firebase Connection Error:", e.message); 
}

const db = getFirestore();

let botConfig = { 
    words: [], allowedGroups: [], 
    antiLink: false, antiLongText: false, antiNsfw: false, antiVirus: false, antiVirusDeep: false, autoBan: true, 
    welcomeToggle: false, welcomeText: 'សួស្តី {name}, សូមស្វាគមន៍មកកាន់ Group!',
    warningToggle: false, warningText: '⚠️ សាររបស់អ្នកត្រូវបានលុបដោយសារបំពានច្បាប់!',
    deleteServiceMsg: true 
};

async function loadData() {
    try {
        const doc = await db.collection('settings').doc('botData').get();
        if (doc.exists) {
            const data = doc.data();
            if (!data.allowedGroups) data.allowedGroups = []; 
            botConfig = { ...botConfig, ...data };
        } else {
            await db.collection('settings').doc('botData').set(botConfig);
        }
    } catch (e) { console.error("❌ Database Load Error:", e); }
}
loadData();

// ==========================================
// ផ្នែកទី២៖ Express Backend API
// ==========================================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SESSION_TOKEN = Math.random().toString(36).substring(2);

app.post('/api/login', (req, res) => {
    if (req.body.user === process.env.ADMIN_USER && req.body.pass === process.env.ADMIN_PASS) {
        res.json({ success: true, token: SESSION_TOKEN });
    } else {
        res.status(401).json({ success: false, message: 'ចូលមិនជោគជ័យ!' });
    }
});

const reqAuth = (req, res, next) => req.headers.authorization === SESSION_TOKEN ? next() : res.status(401).json({});

app.get('/api/config', reqAuth, (req, res) => res.json(botConfig));

app.post('/api/config/update', reqAuth, async (req, res) => {
    try {
        const { type, value } = req.body;
        
        if (type === 'addWord') { 
            const w = value.toLowerCase().trim(); 
            if(w && !botConfig.words.includes(w)) botConfig.words.push(w); 
        } else if (type === 'delWord') {
            botConfig.words = botConfig.words.filter(w => w !== value);
        } else if (type === 'addGroup') {
            const g = value.trim();
            if(g && !botConfig.allowedGroups.includes(g)) botConfig.allowedGroups.push(g);
        } else if (type === 'delGroup') {
            botConfig.allowedGroups = botConfig.allowedGroups.filter(g => g !== value);
        } else {
            const validKeys = [
                'antiLink', 'antiLongText', 'antiNsfw', 'antiVirus', 'antiVirusDeep', 'autoBan', 
                'welcomeToggle', 'welcomeText', 'warningToggle', 'warningText', 'deleteServiceMsg'
            ];
            if (validKeys.includes(type)) botConfig[type] = value;
        }

        await db.collection('settings').doc('botData').set(botConfig, { merge: true });
        res.json({ success: true, config: botConfig });
    } catch (error) { 
        res.status(500).json({ success: false }); 
    }
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.listen(PORT, () => console.log(`✅ Web Server កំពុងដំណើរការលើ Port ${PORT}`));

// ==========================================
// ផ្នែកទី៣៖ Telegram Bot Logic (AI & Security)
// ==========================================
const bot = new Telegraf(process.env.BOT_TOKEN);
const dangerousExtensions = ['.exe', '.bat', '.cmd', '.vbs', '.vbe', '.scr', '.wsf', '.pif', '.msi', '.apk', '.js'];

// 🔒 Anti-Theft Whitelist
bot.use(async (ctx, next) => {
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
        const currentGroupId = ctx.chat.id.toString();
        
        if (botConfig.allowedGroups && botConfig.allowedGroups.length > 0 && !botConfig.allowedGroups.includes(currentGroupId)) {
            console.log(`⚠️ មានគេលួច Add Bot ចូលគ្រុបផ្សេង: ${ctx.chat.title} (ID: ${currentGroupId})`);
            try {
                await ctx.reply("🚫 ខ្ញុំគឺជា Premium Bot ឯកជន។ ខ្ញុំត្រូវបានអនុញ្ញាតឲ្យដំណើរការតែក្នុងគ្រុបដែលបានចុះឈ្មោះក្នុងប្រព័ន្ធប៉ុណ្ណោះ... លាហើយ! 👋");
                await ctx.leaveChat(); 
            } catch (e) {}
            return; 
        }
    }
    return next();
});

// User Commands
bot.command('id', (ctx) => {
    ctx.reply(`អត្តសញ្ញាណគ្រុបនេះ (Group ID) គឺ៖ \`${ctx.chat.id}\`\n\n*(Copy លេខនេះយកទៅដាក់ក្នុង Dashboard)*`, { parse_mode: 'Markdown' });
});

bot.command('ban', async (ctx) => {
    if (ctx.message.reply_to_message) {
        try {
            await ctx.banChatMember(ctx.message.reply_to_message.from.id);
            await ctx.deleteMessage(ctx.message.reply_to_message.message_id);
            await ctx.deleteMessage(ctx.message.message_id); 
        } catch (e) {}
    }
});

// System Messages
bot.on(['new_chat_members', 'left_chat_member'], async (ctx) => {
    if (botConfig.deleteServiceMsg) {
        try { await ctx.deleteMessage(ctx.message.message_id); } catch(e){}
    }
    
    if (ctx.message.new_chat_members && botConfig.welcomeToggle) {
        for (const user of ctx.message.new_chat_members) {
            if (user.id === ctx.botInfo.id) continue; 
            const text = botConfig.welcomeText.replace('{name}', `[${user.first_name}](tg://user?id=${user.id})`);
            try { await ctx.reply(text, { parse_mode: 'Markdown' }); } catch(e){}
        }
    }
});

// Text, Link & File Scanner
// ប្រព័ន្ធស្កេនសារកម្រិតខ្ពស់
bot.on(['message', 'edited_message'], async (ctx) => {
    const message = ctx.message || ctx.editedMessage;
    if (!message || message.new_chat_members || message.left_chat_member) return; 
    
    try {
        const memberInfo = await ctx.getChatMember(message.from.id);
        if (['creator', 'administrator'].includes(memberInfo.status)) return; 
    } catch (error) { return; }

    let shouldDelete = false;
    let reason = botConfig.warningText;

    // ១. ឆែកមើលអក្សរ, លីង, សារវែង
    const text = message.text || message.caption || '';
    if (text) {
        const textLower = text.toLowerCase();
        const cleanText = textLower.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()\s]/g, ""); 
        
        const hasBadWord = botConfig.words.some(w => textLower.includes(w) || cleanText.includes(w.replace(/\s/g, '')));
        const entities = message.entities || message.caption_entities || [];
        const hasLinks = entities.some(e => e.type === 'url' || e.type === 'text_link');
        const isSpamLink = botConfig.antiLink ? hasLinks : (hasLinks && textLower.includes('best'));
        const isLongSpam = botConfig.antiLongText && text.length > 500;

        if (hasBadWord || isSpamLink || isLongSpam) shouldDelete = true;
    }

    // ២. ឆែកមើល File គ្រោះថ្នាក់
    if (!shouldDelete && message.document) {
        const fileName = (message.document.file_name || '').toLowerCase();
        const isDangerousExt = dangerousExtensions.some(ext => fileName.endsWith(ext));

        // ករណីទី១៖ បើកមុខងារលុបភ្លាមៗ (Fast Block)
        if (isDangerousExt && botConfig.antiVirus) {
            shouldDelete = true;
            reason = `🚫 លុបដោយស្វ័យប្រវត្តិ៖ រកឃើញប្រភេទហ្វាយគ្រោះថ្នាក់ (.exe/.apk) !`;
            console.log(`🛡️ Fast Blocked: ${fileName}`);
        }
        
        // ករណីទី២៖ បើកមុខងារស្កេនស៊ីជម្រៅរកមេរោគ (AI VirusTotal Scan)
        else if (botConfig.antiVirusDeep && process.env.VIRUSTOTAL_API_KEY) {
            let scanningMsg;
            try {
                // ប្រាប់សមាជិកគ្រុបថា Bot កំពុងស្កេនមេរោគសិន
                scanningMsg = await ctx.reply(`🔍 កំពុងស្កេនរកមេរោគលើហ្វាយ \`${fileName}\` ជាមួយ AI VirusTotal...`, { reply_to_message_id: message.message_id, parse_mode: 'Markdown' });
                
                // ឆែកមើលទំហំ File ជាមុន (Telegram ឲ្យ Bot ទាញយកត្រឹម 20MB)
                const fileSize = message.document.file_size || 0;
                if (fileSize > 20 * 1024 * 1024) {
                    throw new Error("ហ្វាយមានទំហំធំជាង 20MB (Telegram បិទមិនឲ្យ Bot ទាញយកដើម្បីស្កេនទេ)");
                }

                // ទាញយកលីងហ្វាយពី Telegram
                const fileLink = await ctx.telegram.getFileLink(message.document.file_id);
                
                // បញ្ជូន Link ទៅឲ្យ VirusTotal ស្កេនរាវរកមេរោគ
                const vtResponse = await axios.post('https://www.virustotal.com/api/v3/urls', 
                    new URLSearchParams({ url: fileLink.href }), 
                    { headers: { 'x-api-key': process.env.VIRUSTOTAL_API_KEY } }
                );

                const analysisId = vtResponse.data.data.id;
                
                // រង់ចាំ ៥ វិនាទី ដើម្បីឱ្យ Anti-Virus ធ្វើការវិភាគ
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // ទាញយកលទ្ធផលមកពិនិត្យ
                const reportResponse = await axios.get(`https://www.virustotal.com/api/v3/analyses/${analysisId}`, {
                    headers: { 'x-api-key': process.env.VIRUSTOTAL_API_KEY }
                });

                const stats = reportResponse.data.data.attributes.stats;
                
                // លុបសារដែលប្រាប់ថា "កំពុងស្កេន" ចោលវិញ ពេលស្កេនចប់ដោយជោគជ័យ
                await ctx.deleteMessage(scanningMsg.message_id).catch(() => null);

                // បើមានប្រព័ន្ធ Anti-Virus លើសពី ១ ប្រាប់ថាជាមេរោគ (Malicious)
                if (stats.malicious > 0 || stats.suspicious > 0) {
                    shouldDelete = true;
                    reason = `🦠 🛡️ ប្រព័ន្ធ AI រកឃើញថាហ្វាយ \`${fileName}\` មានផ្ទុកមេរោគ (Malware/Virus) ពិតប្រាកដ!`;
                }
            } catch (vtError) {
                console.error("⚠️ VirusTotal Error:", vtError.message);
                
                // បើមានបញ្ហា (File ធំពេក ឬ API គាំង) លុបសារស្កេនចោល ហើយលោតសារព្រមានប្រាប់គ្រុប
                if (scanningMsg) {
                    await ctx.deleteMessage(scanningMsg.message_id).catch(() => null);
                }
                
                await ctx.reply(`⚠️ **បរាជ័យក្នុងការស្កេនមេរោគ៖** ហ្វាយ \`${fileName}\` មានទំហំធំពេក ឬប្រព័ន្ធ API កំពុងរវល់។\n\n*(សូមប្រុងប្រយ័ត្នមុននឹងបើកហ្វាយនេះ!)*`, { reply_to_message_id: message.message_id, parse_mode: 'Markdown' });
            }
        }
    }

    // ៣. ឆែកមើលរូបភាពអាសអាភាស (AI Sightengine)
    if (!shouldDelete && message.photo && botConfig.antiNsfw) {
        try {
            const photoId = message.photo[message.photo.length - 1].file_id;
            const fileLink = await ctx.telegram.getFileLink(photoId);

            const response = await axios.get('https://api.sightengine.com/1.0/check.json', {
                params: {
                    url: fileLink.href,
                    models: 'nudity-2.0',
                    api_user: process.env.SIGHTENGINE_USER,
                    api_secret: process.env.SIGHTENGINE_SECRET,
                }
            });

            if (response.data.status === 'success') {
                if (response.data.nudity.sexual_activity > 0.5 || response.data.nudity.sexual_display > 0.5 || response.data.nudity.erotica > 0.5) {
                    shouldDelete = true;
                    reason = `🔞 ផ្ទាំងរូបភាពអាសអាភាសត្រូវបានរកឃើញ និងលុបចេញដោយ AI!`;
                }
            }
        } catch (e) { console.error("⚠️ AI Error:", e.message); }
    }

    // ៤. ចាត់វិធានការ
    if (shouldDelete) {
        try {
            await ctx.deleteMessage(message.message_id);
            
            if (botConfig.warningToggle) {
                const warn = await ctx.reply(`${reason}\n👤 អ្នកផ្ញើ៖ ${message.from.first_name}`);
                setTimeout(() => ctx.deleteMessage(warn.message_id).catch(()=>null), 10000);
            }
            
            if (botConfig.autoBan) {
                await ctx.banChatMember(message.from.id);
            }
        } catch (e) { console.log("⚠️ Action Error:", e.message); }
    }
});

bot.launch().then(() => console.log('🚀 Premium Cyber Bot ដំណើរការជោគជ័យ!'));
