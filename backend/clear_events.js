const mongoose = require('mongoose');
require('dotenv').config();

const Event = require('./src/models/Event');

async function clearEvents() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');
    
    const result = await Event.deleteMany({});
    console.log(`Deleted ${result.deletedCount} events from the database.`);
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

clearEvents();
