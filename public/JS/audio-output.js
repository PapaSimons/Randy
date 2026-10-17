/* Squeezelite is supervised by the host service manager, never by Randy. */
$(function(){
    function request(path,body){return fetch('/audio-output/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.json().then(function(data){if(!r.ok)throw Error(data.error);return data;});});}
    function refresh(){request('list').then(function(data){
        if(!data.enabled)return;
        $('#audio-output-settings').prop('hidden',false);
        $('#audio-output-current').text(data.current?.name || 'Unavailable');
        $('#audio-output-change').prop('disabled',!data.canChange);
        $('#audio-output-select').empty();(data.devices||[]).forEach(function(device){$('#audio-output-select').append($('<option>').val(device.id).text(device.name+(device.systemDefault?' (system default)':'')).prop('selected',device.id===data.current?.id));});
        $('#audio-output-message').text(data.error || '');
    }).catch(function(error){$('#audio-output-settings').prop('hidden',false);$('#audio-output-message').text(error.message);});}
    $('#audio-output-change').on('click',function(){
        var opening=$('#audio-output-options').prop('hidden');
        $('#audio-output-options').prop('hidden',!opening);
        $(this).attr('aria-expanded',String(opening));
        if(opening)refresh();
    });
    $('#audio-output-save').on('click',function(){
        $(this).prop('disabled',true);$('#audio-output-message').text('Restarting Squeezelite…');
        request('change',{id:$('#audio-output-select').val()}).then(function(){
            $('#audio-output-options').prop('hidden',true);$('#audio-output-change').attr('aria-expanded','false');refresh();
        }).catch(function(error){$('#audio-output-message').text(error.message);}).finally(function(){$('#audio-output-save').prop('disabled',false);});
    });
    refresh();
});
