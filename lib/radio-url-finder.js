#!/bin/env node
const dns = require('dns').promises;
const util = require('util');
const resolveSrv = util.promisify(dns.resolveSrv);

/**
 * Get a list of base urls of all available radio-browser servers
 * Returns: array of strings - base urls of radio-browser servers
 */

async function get_radiobrowser_base_urls() {
  try {
    const hosts = await dns.resolveSrv('_api._tcp.radio-browser.info');
    return hosts
      .sort((a, b) => a.priority - b.priority)
      .map(h => `https://${h.name}`);
  } catch (err) {
    console.warn('SRV lookup failed, falling back:', err.code);
    return [
      'https://de1.api.radio-browser.info',
      'https://nl1.api.radio-browser.info',
      'https://fr1.api.radio-browser.info'
    ];
  }
}

/**
 * Get a random available radio-browser server.
 * Returns: string - base url for radio-browser api
 */
function get_radiobrowser_base_url_random() {
    return get_radiobrowser_base_urls().then(hosts => {
        var item = hosts[Math.floor(Math.random() * hosts.length)];
        return item;
    });
}

module.exports = {
    getAPIURL: async function(){
        return get_radiobrowser_base_url_random();
    }
}