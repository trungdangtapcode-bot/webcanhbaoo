require('dotenv').config();
const { connectDatabase, isDatabaseConnected } = require('./src/config/database');
const Event = require('./src/models/Event');
const mongoose = require('mongoose');

async function clear() {
  await connectDatabase();
  if (isDatabaseConnected()) {
    const result = await Event.deleteMany({});
    console.log(`Deleted ${result.deletedCount} events from DB.`);
  } else {
    console.log('Could not connect to DB.');
  }
  process.exit(0);
}

clear();
