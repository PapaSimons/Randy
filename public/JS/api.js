var api = {
    /* host url */
    hurl:window.location.origin + "/",
    getURLMeta: function (u){
        return $.ajax({
            method: "POST",
            url: api.hurl + "getURLMeta",
            data: {
                url:u
            }
        });
    },
    searchSongs: function (k){
        return $.ajax({
            method: "POST",
            url: api.hurl + "searchSongs",
            data: {
                keyword:k
            }
        });
    },
    getStickyList: function (l){
        return $.ajax({
            method: "POST",
            url: api.hurl + "getStickyList",
            data: {
                limit:l
            }
        });
    },
    getRandomAlbums: function (l){
        return $.ajax({
            method: "POST",
            url: api.hurl + "getRandomAlbums",
            data: {
                limit:l
            }
        });
    },
    getAlbums: function (l){
        return $.ajax({
            method: "POST",
            url: api.hurl + "getAlbums",
            data: {
                limit:l
            }
        });
    }
}

console.log("api - " + api.hurl);