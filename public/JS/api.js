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
    getAlbum: function (d){
        return $.ajax({
            method: "POST",
            url: api.hurl + "getAlbum",
            data: {
                albumdir:d
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
    },
    setMusicFolder: function (mf){
        return $.ajax({
            method: "POST",
            url: api.hurl + "setMusicFolder",
            data: {
                mf:mf
            }
        });
    }
}

console.log("api - " + api.hurl);