/**
 * Created by jmooreoa on 1/5/17.
 */
const headers = {
    'User-Agent': 'BYU-Web-Community-CDN 1.0.0-dev'
};

if (process.env.GITHUB_USER && process.env.GITHUB_TOKEN) {
    headers['Authorization'] = 'Basic ' + Buffer.from(process.env.GITHUB_USER + ':' + process.env.GITHUB_TOKEN).toString('base64');
}

const req = require('request').defaults({
    headers: headers
});
const reqp = require('request-promise-native').defaults({
    headers: headers
});
const fs = require('fs');
const yaml = require('node-yaml');


exports.GithubFetcher = class {
    constructor(source) {
        this.source = source;
        this._baseUrl = `https://api.github.com/repos/${source}`;
        [this.owner, this.repo] = source.split('/');
    }

    /**
     * @return Promise<string[]>
     */
    availableVersions() {
        console.log('fetching versions from', this.source);
        let master = reqp(`${this._baseUrl}/branches/master`)
            .then(data => {
                let b = JSON.parse(data);
                return [{
                    name: 'unstable',
                    ref: 'master',
                    tarball: `${this._baseUrl}/tarball/master`,
                    git_sha: b.commit.sha
                }];
            });
        let tags = reqp(`${this._baseUrl}/tags`)
            .then(data => {
                let tags = JSON.parse(data);
                return tags.map(each => {
                    return {
                        name: unV(each.name),
                        ref: each.name,
                        tarball: each.tarball_url,
                        git_sha: each.commit.sha
                    };
                });
            });
        return Promise.all([master, tags]).then(results => {
            return [].concat(...results);
        });
    }

    fetchConfig(ref) {
        return reqp(`${this._baseUrl}/contents/.cdn-config.yml?ref=${ref}`)
            .then(data => {
                let parsed = JSON.parse(data);
                let content = Buffer.from(parsed.content, 'base64').toString();
                let cfg = yaml.parse(content);
                cfg.resourceMappings = cfg.resources.map(each => {
                    if (typeof each === 'string') {
                        return {
                            src: each
                        };
                    } else if (typeof each === 'object') {
                        return each;
                    } else {
                        throw 'Invalid type for resource entry: ' + typeof each;
                    }
                });
                delete cfg.resources;
                return cfg;
            });
    }

    fetchTarball(url, dest) {
        let output = fs.createWriteStream(dest);
        return new Promise((resolve, reject) => {
            req(url)
                .on('response', () => {
                    resolve();
                })
                .on('error', reject)
                .pipe(output)
        });
    }

    viewRefUrl(ref) {
        return `https://github.com/${this.source}/tree/${ref}`;
    }
};

function unV(str) {
    "use strict";
    if (str.toLowerCase().indexOf('v') === 0) {
        return str.substring(1);
    }
    return str;
}

