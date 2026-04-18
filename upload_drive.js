const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const FOLDER_ID = '1Dp_288cOoWiZ3mIIM8Lsp7YoYT4kYh-s';

async function uploadToDrive(filePath, mimeType) {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  const drive = google.drive({ version: 'v3', auth });
  const fileName = path.basename(filePath);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [FOLDER_ID]
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath)
    },
    supportsAllDrives: true,
    fields: 'id, name'
  });

  console.log('Uploaded: ' + fileName + ' (ID: ' + response.data.id + ')');
  return response.data;
}

async function main() {
  const today = new Date().toISOString().split('T')[0];
  const reelImage = path.join(__dirname, 'reel_output', `reel_${today}.png`);
  const reelVideo = path.join(__dirname, 'reel_output', `video_${today}.mp4`);

  if (fs.existsSync(reelImage)) {
    await uploadToDrive(reelImage, 'image/png');
  } else {
    console.log('Image not found: ' + reelImage);
  }

  if (fs.existsSync(reelVideo)) {
    await uploadToDrive(reelVideo, 'video/mp4');
  } else {
    console.log('Video not found: ' + reelVideo);
  }

  console.log('All uploaded to Google Drive!');
}

main().catch(console.error);