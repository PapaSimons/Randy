// ==============================================
// Randy Player
// built by : Gideon Simons, 2018-2023
// ==============================================

var api = {
    /* host url */
    hurl:window.location.origin + "/",
    requestsObj:{},
    randy: function (u){
        return callAPI("randy",{});
    },
    getURLMeta: function (u){
        return callAPI("getURLMeta",{url:u});
    },
    searchSongs: function (k){
        return callAPI("searchSongs",{keyword:k});
    },
    getStickyList: function (l){
        return callAPI("getStickyList",{limit:l});
    },
    getRandomAlbums: function (l){
        return callAPI("getRandomAlbums",{limit:l});
    },
    getAlbum: function (d){
        return callAPI("getAlbum",{albumdir:d});
    },
    getAlbums: function (l){
        return callAPI("getAlbums",{limit:l});
    },
    setMusicFolder: function (mf){
        return callAPI("setMusicFolder",{mf:mf});
    },
    getSettings: function (mf){
        return callAPI("getSettings",{});
    },
    setSetting: function (obj,key){
        return callAPI("setSetting",{obj:obj,key:key});
    },
    powerOff: function (){
        return callAPI("powerOff",{});
    }
}

console.log("api - " + api.hurl);

function callAPI(c,d){
    if (api.requestsObj.hasOwnProperty(c)){
        var lastreq = api.requestsObj[c];
    }
    api.requestsObj[c] = $.ajax({
        method: "POST",
        url: api.hurl + c,
        data: d,
        beforeSend : function() {
            if(lastreq && lastreq.readyState < 4) {
                lastreq.abort();
            }
        }
    });
    return api.requestsObj[c];
}