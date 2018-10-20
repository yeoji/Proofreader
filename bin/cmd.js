#!/usr/bin/env node

//Helpers
var fs = require('fs');
var path = require('path');
var program = require('commander');
var mime = require('mime');
var marked = require('marked');
var clc = require('cli-color');
var config = require('../settings.json');
var Proofreader = require('../lib/proofreader.js');
var SourceLoader = require('../lib/sourceloader.js');

program
  .option('-u, --url [url]', 'URL to website that should be proofread.')
  .option('-f, --file [path]', 'Path to HTML or Markdown file that should be proofread.')
  .option('-l, --file-list [path]', 'Path to a list of files that should be proofread.')
  .option('-c, --config-file [path]', 'Path to a custom configuration file.')
  .option('-o, --output [print|json]', 'Whether to print the results or save as JSON')
  .parse(process.argv);

//if custom config file was provided
if (program.configFile) {
  config = JSON.parse(fs.readFileSync(program.configFile));
}

//configuration validation
if (!config) {
  throw new Error('Configuration object missing.');
} else if (!config.dictionaries['build-in'] || !config.dictionaries['build-in'].length) {
  throw new Error('At least one build-in dictionary has to be set.');
} else if (!config.selectors || !config.selectors.whitelist) {
  throw new Error('Whitelist has to be set.');
}

var proofreader = new Proofreader();

proofreader.setWhitelist(config.selectors.whitelist);
proofreader.setBlacklist(config.selectors.blacklist);
proofreader.setWriteGoodSettings(config['write-good']);

config.dictionaries['build-in'].forEach(function (dictName) {
  proofreader.addDictionary(path.join(__dirname, '../dictionaries/' + dictName + '.dic'),
    path.join(__dirname, '../dictionaries/' + dictName + '.aff'));
});

if (config.dictionaries['custom']) {
  config.dictionaries['custom'].forEach(function (dictPath) {
    proofreader.addDictionary(dictPath);
  });
}

function toHTML(path, content) {
  var mimeType = mime.getType(path);

  if (mimeType === 'text/markdown') {
    return marked(content);
  }

  return content;
}

function printResults(allFiles) {
   allFiles.forEach(function (file) {
      console.log('### Results for ' + file.file + ' ###');
      console.log();

      file.results.forEach(function (result) {
        var writeGood = result.suggestions.writeGood;
        var spelling = result.suggestions.spelling;

        //Printing output
        if (writeGood.length || spelling.length) {
          console.log(clc.red(result.text));

          writeGood.forEach(function (item) {
            console.log(clc.blue.bold(' - ' + item.reason));
          });

          spelling.forEach(function (item) {
            console.log(clc.magenta.bold(' - "' + item.word + '" -> ' + item.suggestions));
          });

          console.log();
        }
      });
   });
}

function saveResultsJSON(jsonResults) {
   var resultsFile = 'results.json';
   if(fs.existsSync(resultsFile)) {
      fs.writeFileSync(resultsFile, '');
   }
   fs.appendFileSync(resultsFile, JSON.stringify(jsonResults));
}

var sourceLoader = new SourceLoader();

//TODO #7 - there is no longer need to distinguish between a file and URI
if (program.url || program.file) {
  sourceLoader.add(program.url || program.file);
} else if (program.fileList) {
  var listOfFiles = fs.readFileSync(program.fileList).toString().split("\n");

  listOfFiles.forEach(function (path) {
    if (path.length > 0) {
      sourceLoader.add(path);
    }
  });
}

results = [];
sourceLoader
  .load()
  .then(function (sources) {
    return Promise.all(sources.map(function (source) {
      if (source.error) {
        console.log("### Proofreader *failed* to load", source.path, "###");
        console.log(source.error);
        console.log();
        return;
      }

      return proofreader.proofread(toHTML(source.path, source.content))
        .then(function (result) {
          var result = result.filter(function (r) {
             var writeGood = r.suggestions.writeGood;
             var spelling = r.suggestions.spelling;
             return writeGood.length || spelling.length;
          });
          var jsonResult = {
             file: source.path,
             results: result
          };
          results.push(jsonResult);
          return result;
        })
        .catch(function (error) {
          console.error('Proofreading failed', error);
        });
    }));
  })
  .then(function (files) {
   if(program.output === 'json') {
     saveResultsJSON(results);
   } else {
     printResults(results);
     files.forEach(function (paragraphs) {
        //if there are any suggestions exit with 1
        if (paragraphs && paragraphs.length > 0) {
          process.exit(1);
        }
     });
   }
  });
