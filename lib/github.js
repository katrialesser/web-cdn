/**
 * Created by jmooreoa on 1/20/17.
 */
"use strict";

const headers = {
    'User-Agent': 'BYU-Web-Community-CDN 1.0.0-dev'
};

if (process.env.GITHUB_USER && process.env.GITHUB_TOKEN) {
    headers['Authorization'] = 'Basic ' + Buffer.from(process.env.GITHUB_USER + ':' + process.env.GITHUB_TOKEN).toString('base64');
}

const req = require('request').defaults({
    headers: headers
});

const fs = require('fs');

module.exports = {
  getTarball(owner, repo, ref, dest) {
      let output = fs.createWriteStream(dest);
      return new Promise((resolve, reject) => {
          req(`https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`)
              .on('response', resolve)
              .on('error', reject)
              .pipe(output);
      })
  }
};

