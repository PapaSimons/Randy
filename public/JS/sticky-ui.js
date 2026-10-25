/* Sticky title editing leaves the existing path-based play/add/delete actions intact. */
var stickyUI = (function () {
    'use strict';
    function row(sticky, list, index) {
        var el=$('<div class="search-result sticky-row">').attr('data-sticky-id',sticky.id);
        var group=$('<div class="sticky-title-group">'),view=$('<div class="sticky-title-view">');
        var title=$('<button type="button" class="sticky-play">');
        if(sticky.source==='spotify')title.append(randyUI.sourceIcon('spotify'));
        var label=$('<span class="sticky-label">').text(sticky.name || '');
        title.append(label).on('click',function(){doSongOption('playnow',list,index);});
        var edit=randyUI.actionButton('edit','Edit sticky title',function(){begin();});
        view.append(title);group.append(view);el.append(group);
        var options=$('<div class="search-result-options">').html(songoptions(list,index));
        options.find('.randy-item-actions').prepend(edit);el.append(options);
        function begin() {
            if(group.find('form').length)return;
            var pending=false,form=$('<form class="sticky-title-editor">');
            var input=$('<input type="text" maxlength="100" aria-label="Sticky title">').val(label.text());
            var save=randyUI.actionButton('check','Save sticky title',function(){submit();});
            var cancel=randyUI.actionButton('close','Cancel editing sticky title',close);
            var message=$('<span class="sticky-title-error" role="status">');
            function close(){if(pending)return;form.remove();view.show();edit.trigger('focus');}
            function submit(){
                if(pending)return;
                var value=input.val().trim();
                if(!value || value.length>100){message.text('Use a title between 1 and 100 characters.');input.trigger('focus');return;}
                pending=true;input.add(save).add(cancel).prop('disabled',true);message.text('');
                api.renameSticky(sticky.id,value).then(function(result){
                    sticky.name=result.sticky.name;
                    $('.sticky-row[data-sticky-id="'+sticky.id+'"] .sticky-label').text(sticky.name);
                    pending=false;close();
                }).fail(function(response){
                    pending=false;input.add(save).add(cancel).prop('disabled',false);
                    message.text(response.status===404 && !response.responseJSON ? 'Restart Randy and refresh this page to enable sticky title editing.' : response.responseJSON && response.responseJSON.error || 'Could not save the sticky title. Please try again.');
                    input.trigger('focus');
                });
            }
            form.on('submit',function(event){event.preventDefault();event.stopPropagation();submit();});
            form.on('keydown',function(event){
                if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
                else if(event.key==='Enter' && event.target===input[0]){event.preventDefault();event.stopPropagation();submit();}
            });
            form.append(input,save,cancel,message);view.hide();group.append(form);input.trigger('focus').trigger('select');
        }
        return el;
    }
    return {row:row};
}());
