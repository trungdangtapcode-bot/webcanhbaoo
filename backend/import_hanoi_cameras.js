const mongoose = require('mongoose');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI).then(() => {
  console.log('Connected to MongoDB');
  importData();
}).catch(err => {
  console.error('Failed to connect to MongoDB', err);
  process.exit(1);
});

const Camera = require('./src/models/Camera');

async function importData() {
  try {
    // Read the JSON file
    const data = JSON.parse(fs.readFileSync('hanoi_cameras.json', 'utf8'));
    
    let camerasList = [];
    if (data.data && Array.isArray(data.data)) {
        camerasList = data.data; // Handle the paginated JSON format
    } else if (Array.isArray(data)) {
        camerasList = data; // Handle direct array format
    } else {
        throw new Error('Unknown JSON format. Expected an array or an object with a "data" array.');
    }

    console.log(`Found ${camerasList.length} cameras in the JSON file.`);

    // Clear existing real cameras (optional, you can remove this if you want to keep old ones)
    // await Camera.deleteMany({});
    
    let importedCount = 0;

    for (const cam of camerasList) {
      // Extract stream URL
      let streamUrl = 'https://www.youtube.com/watch?v=sTF-6_xinUU'; // fallback
      if (cam.profile && cam.profile[0] && cam.profile[0].streams) {
          const httpsStream = cam.profile[0].streams.find(s => s.protocol === 'HTTPS');
          if (httpsStream) {
              streamUrl = httpsStream.source;
          }
      }

      // Check if camera already exists to avoid duplicates
      const existingCam = await Camera.findOne({ camera_id: `HANOI_${cam.id}` });
      if (!existingCam) {
        await Camera.create({
          camera_id: `HANOI_${cam.id}`,
          name: cam.name,
          location: {
            lat: cam.lat,
            lng: cam.lng,
            address: cam.address || `${cam.ward_name || ''}, Hà Nội`
          },
          active: cam.availability === 1,
          // Since streamUrl is not in schema, we skip it or you could add it to schema
        });
        importedCount++;
      }
    }

    console.log(`✅ Successfully imported ${importedCount} new cameras!`);
    console.log('You can now check your map dashboard.');
    
  } catch (error) {
    console.error('Error importing data:', error.message);
  } finally {
    mongoose.connection.close();
  }
}
