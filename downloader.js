const ProgressBar = require('progress');
const sleep = require('sleep');
const pg = require('pg');
const fs = require('fs');
const path = require('path');
const mkpath = require('mkpath');
const async = require('async');
const exec = require('child_process').exec;
const crypto = require('crypto');
const moment = require('moment');

// constants
const conString = "postgres://lspyer@localhost/rubygems";

// Function definition

console.reset = function () {
  return process.stdout.write('\033c');
}

var showGreeting = function () {
  console.log(`
  ██████╗ ██╗   ██╗██████╗ ██╗   ██╗ ██████╗ ███████╗███╗   ███╗███████╗    ██████╗  ██████╗ ██╗    ██╗███╗   ██╗██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
  ██╔══██╗██║   ██║██╔══██╗╚██╗ ██╔╝██╔════╝ ██╔════╝████╗ ████║██╔════╝    ██╔══██╗██╔═══██╗██║    ██║████╗  ██║██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
  ██████╔╝██║   ██║██████╔╝ ╚████╔╝ ██║  ███╗█████╗  ██╔████╔██║███████╗    ██║  ██║██║   ██║██║ █╗ ██║██╔██╗ ██║██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
  ██╔══██╗██║   ██║██╔══██╗  ╚██╔╝  ██║   ██║██╔══╝  ██║╚██╔╝██║╚════██║    ██║  ██║██║   ██║██║███╗██║██║╚██╗██║██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
  ██║  ██║╚██████╔╝██████╔╝   ██║   ╚██████╔╝███████╗██║ ╚═╝ ██║███████║    ██████╔╝╚██████╔╝╚███╔███╔╝██║ ╚████║███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
  ╚═╝  ╚═╝ ╚═════╝ ╚═════╝    ╚═╝    ╚═════╝ ╚══════╝╚═╝     ╚═╝╚══════╝    ╚═════╝  ╚═════╝  ╚══╝╚══╝ ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
  `);
}

var SQLDateformatter = function(date) {
  if (!date) {
    // date = Date.min()
    date = new Date(0);
  }

  var yyyy = date.getFullYear().toString();
  var mm = (date.getMonth()+1).toString(); // getMonth() is zero-based
  var dd  = date.getDate().toString();

  return `${yyyy}-${(mm[1]?mm:"0"+mm[0])}-${(dd[1]?dd:"0"+dd[0])}`;
};

var queryDB = function (query, callback) {

  var client = new pg.Client(conString);
  client.connect((err) => {
    if (err) {
      return console.error('ERROR Connecting to the local RubyGem DB.', err);
    }

    client.query(query, [], (err, result) => {
      client.end();

      if (err) {
        console.error('error running query', err);
        return callback()
      }

      return callback(result);
    });
  });
}

var queryNumberGemsToDownload = function (date, callback) {
  var query = `
  SELECT
    count(*)
  FROM
    public.versions
  WHERE
    versions.created_at > '${SQLDateformatter(date)}';
  `

  queryDB(query, (result) => {
    if (!result) {
      return callback(0);
    }

    callback(result.rows[0].count);
  });
}

var queryGemsRowsToDownload = function (date, callback) {
  var query = `
  SELECT
    rubygems.name,
    versions."number",
    versions.created_at,
    versions.updated_at,
    versions.full_name,
    versions.sha256
  FROM
    public.versions,
    public.rubygems
  WHERE
    versions.rubygem_id = rubygems.id and
    versions.created_at > '${SQLDateformatter(date)}'
  ORDER BY created_at;
  `
  queryDB(query, (result) => {
    if (!result) {
      return callback([]);
    }

    callback(result.rows);
  });
}

var downloadGems = function (gemsInfo, downloadPath) {
  if (!downloadPath) {
    downloadPath = './';
  }

  downloadPath = path.join(downloadPath, 'gems');
  var err = mkpath.sync(downloadPath);
  if (err) {
    return console.error(err);
  }

  var bar = new ProgressBar('downloaded :current of :total gems [:bar] :percent', {
      complete: '=',
      incomplete: '-',
      width: 20,
      total: gemsInfo.length
    });

  bar.tick(0);

  async.forEachOfLimit(gemsInfo, 20, (gemInfo, index, next) => {
    var finishIteration = function () {
      bar.tick();
      next();
    }

    var filePath = path.join(downloadPath, `${gemInfo.full_name}.gem`);
    if (fileExists(filePath)) {
      return calcSHA256CheckSum(filePath, (calculatedSha) => {
        if (calculatedSha === calcSHA256FromGemInfo(gemInfo))
        {
          return finishIteration();
        }
        return execGemFetch(downloadPath, gemInfo, finishIteration);
      });
    }
    return execGemFetch(downloadPath, gemInfo, finishIteration);
  }, () => {});
}

var execGemFetch = function (downloadPath, gemInfo, callback) {
  exec(`cd ${downloadPath} && gem fetch ${gemInfo.name} -v ${gemInfo.number}`,
      {
        encoding: 'utf8'
      },
      (error, stdout, stderr) => {
        if (error) {
          console.log(`An ERROR accured while downloading ${gemsInfo.full_name}`);
          console.log(error);
        }
        return callback();
      });
}

var saveJSON = function (gemsInfo, savePath) {
  if (!savePath) {
    savePath = './';
  }

  var err = mkpath.sync(savePath);
  if (err) {
     return console.error(err);
  }

  var err = fs.writeFileSync(
    path.join(savePath,'manifest.json'),
    JSON.stringify(gemsInfo, null, 4),
    'utf8');
  if (err) {
     return console.error(err);
  }
}

var calcSHA256CheckSum = function (filename, callback) {
  var shasum = crypto.createHash('sha256');

  var fileStream = fs.ReadStream(filename);
  fileStream.on('data', (data) => { shasum.update(data); });
  fileStream.on('error', (err) => {
    console.error(err);
    callback();
  });
  fileStream.on('end', () => {
    callback(shasum.digest('hex'));
  });
}

var calcSHA256FromGemInfo = function (gemInfo) {
  return new Buffer(gemInfo.sha256, 'base64').toString('hex');
}

var fileExists = function (filePath) {
  try {
    stats = fs.lstatSync(filePath);
    return stats.isFile()
  }
  catch (e) {
    return false;
  }
}

var tryParseDate = function (arg) {
  var date = moment(arg, "DD/MM/YYYY");
  if (!date.isValid()) {
    console.error(`ERROR: date format is not in the form of dd/mm/yyyy, ${arg}`);
    process.exit(-1);
  }
  return date.toDate();
}

var tryParseDirectory = function (arg) {
  if (!arg) {
    console.error(`ERROR: directory parameter is undefined`);
    process.exit(-1);
  }
}

var printArgumentsError = function () {
  console.log(`Usage: -o [Download Directory] -d [Date to query from dd/mm/yyyy]`);
  process.exit(-1);
}

// main

var queryDate;
var downloadFolder = 'downloads';

try {
  for (var i=2; i<process.argv.length; i=i+2) {
    switch(process.argv[i]) {
      case '-d':
        queryDate = tryParseDate(process.argv[i+1])
        break;
      case '-o':
        downloadFolder = process.argv[i+1];
        break;
      default:
        printArgumentsError();
    }
  }
}
catch (e) {
  printArgumentsError();
}

console.reset();
showGreeting();

var dateString = queryDate ? queryDate.toLocaleDateString() : 'the begining of time';

console.log(`Querying Gems to download from RubyGems (from ${dateString}).`);
queryNumberGemsToDownload(queryDate, (count) => {
  queryGemsRowsToDownload(queryDate, (gemsInfo) => {
    console.log(`Done! found ${count} new Gems to download (from ${dateString}).`);
    downloadGems(gemsInfo, downloadFolder);
    saveJSON(gemsInfo, downloadFolder);
  })
});