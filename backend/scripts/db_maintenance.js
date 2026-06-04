const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

require('dotenv').config();

const mongoose = require('mongoose');
const Event = require('../src/models/Event');

function parseArgs(argv) {
  const args = { execute: false, help: false };
  argv.forEach((arg) => {
    if (arg === '--execute') args.execute = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--')) {
      const [key, rawValue = 'true'] = arg.slice(2).split('=');
      args[key] = rawValue;
    }
  });
  return args;
}

function parsePositiveInt(value, name) {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function cutoffDate(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function mb(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

async function getCollectionStats(db) {
  const collections = await db.listCollections().toArray();
  const stats = [];
  for (const col of collections) {
    const s = await db.command({ collStats: col.name });
    stats.push({
      collection: col.name,
      count: s.count,
      sizeMB: mb(s.size),
      storageMB: mb(s.storageSize),
      indexMB: mb(s.totalIndexSize),
    });
  }
  return stats.sort((a, b) => b.storageMB - a.storageMB);
}

async function getEventPayloadStats(filter = {}) {
  const [stats] = await Event.aggregate([
    { $match: filter },
    {
      $project: {
        timestamp: 1,
        imageBytes: { $strLenBytes: { $ifNull: ['$image_base64', ''] } },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        withImages: { $sum: { $cond: [{ $gt: ['$imageBytes', 0] }, 1, 0] } },
        imageBytes: { $sum: '$imageBytes' },
        oldest: { $min: '$timestamp' },
        newest: { $max: '$timestamp' },
      },
    },
  ]);

  return stats || {
    total: 0,
    withImages: 0,
    imageBytes: 0,
    oldest: null,
    newest: null,
  };
}

async function getEventPayloadStatsForIds(ids = []) {
  if (!ids.length) return getEventPayloadStats({ _id: { $in: [] } });
  return getEventPayloadStats({ _id: { $in: ids } });
}

async function printStats(db) {
  const collections = await getCollectionStats(db);
  const events = await getEventPayloadStats();
  console.log(JSON.stringify({
    collections,
    events: {
      total: events.total,
      withImages: events.withImages,
      imagePayloadMB: mb(events.imageBytes),
      oldest: events.oldest,
      newest: events.newest,
    },
  }, null, 2));
}

async function planOrRun({ execute, deleteDays, keepLatestEvents, stripImagesDays }) {
  const operations = [];

  if (stripImagesDays) {
    const cutoff = cutoffDate(stripImagesDays);
    const filter = {
      timestamp: { $lt: cutoff },
      image_base64: { $type: 'string', $ne: '' },
    };
    const stats = await getEventPayloadStats(filter);
    operations.push({
      operation: 'strip_event_images',
      cutoff,
      matched: stats.total,
      estimatedFreedPayloadMB: mb(stats.imageBytes),
    });

    if (execute && stats.total) {
      const result = await Event.updateMany(filter, { $unset: { image_base64: '' } });
      operations[operations.length - 1].modified = result.modifiedCount;
    }
  }

  if (deleteDays) {
    const cutoff = cutoffDate(deleteDays);
    const filter = { timestamp: { $lt: cutoff } };
    const stats = await getEventPayloadStats(filter);
    operations.push({
      operation: 'delete_old_events',
      cutoff,
      matched: stats.total,
      estimatedRemovedPayloadMB: mb(stats.imageBytes),
    });

    if (execute && stats.total) {
      const result = await Event.deleteMany(filter);
      operations[operations.length - 1].deleted = result.deletedCount;
    }
  }

  if (keepLatestEvents) {
    const total = await Event.countDocuments({});
    const deleteCount = Math.max(total - keepLatestEvents, 0);
    const idsToDelete = deleteCount
      ? await Event.find({})
        .sort({ _id: 1 })
        .limit(deleteCount)
        .select({ _id: 1 })
        .lean()
      : [];
    const ids = idsToDelete.map((doc) => doc._id);
    const stats = await getEventPayloadStatsForIds(ids);
    operations.push({
      operation: 'delete_events_keep_latest',
      total,
      keepLatestEvents,
      matched: ids.length,
      estimatedRemovedPayloadMB: mb(stats.imageBytes),
    });

    if (execute && ids.length) {
      const result = await Event.deleteMany({ _id: { $in: ids } });
      operations[operations.length - 1].deleted = result.deletedCount;
    }
  }

  console.log(JSON.stringify({
    mode: execute ? 'execute' : 'dry-run',
    operations,
    note: execute
      ? 'MongoDB may not immediately reduce allocated storage until compaction/repacking happens.'
      : 'No data was changed. Add --execute to run these operations.',
  }, null, 2));
}

function printHelp() {
  console.log(`MongoDB maintenance

Usage:
  node scripts/db_maintenance.js --stats
  node scripts/db_maintenance.js --strip-images-older-than-days=7
  node scripts/db_maintenance.js --strip-images-older-than-days=7 --execute
  node scripts/db_maintenance.js --delete-events-older-than-days=30
  node scripts/db_maintenance.js --delete-events-older-than-days=30 --execute
  node scripts/db_maintenance.js --keep-latest-events=500
  node scripts/db_maintenance.js --keep-latest-events=500 --execute

Options:
  --stats                              Print collection and event image payload stats.
  --strip-images-older-than-days=N     Unset image_base64 on old events, keeping metadata/history.
  --delete-events-older-than-days=N    Delete old event documents entirely.
  --keep-latest-events=N               Delete older events and keep only the latest N.
  --execute                            Actually modify data. Without this, the script is dry-run.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const deleteDays = parsePositiveInt(args['delete-events-older-than-days'], '--delete-events-older-than-days');
  const keepLatestEvents = parsePositiveInt(args['keep-latest-events'], '--keep-latest-events');
  const stripImagesDays = parsePositiveInt(args['strip-images-older-than-days'], '--strip-images-older-than-days');
  const wantsStats = args.stats === 'true' || (!deleteDays && !keepLatestEvents && !stripImagesDays);

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured');
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 4,
    serverSelectionTimeoutMS: 15000,
  });

  try {
    if (wantsStats) {
      await printStats(mongoose.connection.db);
    } else {
      await planOrRun({ execute: args.execute, deleteDays, keepLatestEvents, stripImagesDays });
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[DB maintenance] Failed:', err.message);
  process.exit(1);
});
