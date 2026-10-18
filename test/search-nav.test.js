'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {activeSection}=require('../public/JS/search-nav');
test('section tracking accounts for a sticky menu and headings already above the scrollport',()=>{
    assert.equal(activeSection([100,500,900],150,false),0);
    assert.equal(activeSection([-400,40,440],80,false),1);
    assert.equal(activeSection([-800,-360,40],80,false),2);
});
test('the last short section activates at the bottom even if it cannot reach the sticky menu',()=>{
    assert.equal(activeSection([-700,100,280],60,true),2);
});
test('empty and single-source search results are valid',()=>{
    assert.equal(activeSection([],80,false),-1);
    assert.equal(activeSection([100],80,false),0);
});
