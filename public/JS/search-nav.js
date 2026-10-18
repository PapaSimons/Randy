/* Section navigation follows the existing browse pane, not the window. */
(function () {
    'use strict';
    function activeSection(tops, threshold, atBottom) {
        if (!tops.length) return -1;
        if (atBottom) return tops.length - 1;
        var index = 0;
        tops.forEach(function (top, i) { if (top <= threshold) index = i; });
        return index;
    }
    if (typeof module !== 'undefined' && module.exports) { module.exports = { activeSection: activeSection }; return; }
    var scroller = document.getElementById('browse-modes');
    var results = document.getElementById('browse-search-results');
    var nav = document.getElementById('search-section-nav');
    if (!scroller || !results || !nav) return;
    var headings = [], buttons = [], scheduled = false;
    function update() {
        scheduled = false;
        var visible = results.getClientRects().length > 0 && headings.length > 0;
        nav.hidden = !visible;
        nav.parentElement.classList.toggle('has-sections', visible);
        if (!visible) return;
        // Allow one pixel for fractional layout coordinates / rounded scrollTop.
        var threshold = scroller.getBoundingClientRect().top + scroller.clientTop + 9;
        var bottom = scroller.scrollHeight > scroller.clientHeight + 1 &&
            scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
        var index = activeSection(headings.map(function (heading) { return heading.getBoundingClientRect().top; }), threshold, bottom);
        buttons.forEach(function (button, i) {
            button.classList.toggle('active', i === index);
            if (i === index) button.setAttribute('aria-current', 'location');
            else button.removeAttribute('aria-current');
        });
    }
    function schedule() {
        if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
    }
    function rebuild() {
        headings = Array.from(results.querySelectorAll('[data-search-section]'));
        nav.replaceChildren(); buttons = [];
        nav.hidden = headings.length < 1 || !results.getClientRects().length;
        headings.forEach(function (heading) {
            var button = document.createElement('button');
            button.type = 'button';
            var label = document.createElement('span'), count = document.createElement('span');
            label.textContent = heading.getAttribute('data-search-section');
            var number = Number(heading.getAttribute('data-search-count'));
            count.className = 'search-section-count';
            count.textContent = Number.isFinite(number) && number >= 0 ? String(number) : '';
            button.append(label, count);
            button.setAttribute('aria-label',label.textContent+', '+count.textContent+' results');
            button.setAttribute('aria-controls', heading.id);
            button.addEventListener('click', function () {
                var top = scroller.scrollTop + heading.getBoundingClientRect().top -
                    scroller.getBoundingClientRect().top - scroller.clientTop - 8;
                var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                scroller.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'instant' : 'smooth' });
            });
            nav.appendChild(button); buttons.push(button);
        });
        schedule();
    }
    // Local and Spotify results arrive separately. Observing only their roots
    // avoids reacting to our own navigation/highlight changes.
    var observer = new MutationObserver(rebuild);
    ['local-search-results', 'spotify-search-results'].forEach(function (id) {
        observer.observe(document.getElementById(id), { childList: true, subtree: true });
    });
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    if (typeof ResizeObserver !== 'undefined') {
        var resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(nav); resizeObserver.observe(results);
    }
    window.randySearchNav = {refresh:rebuild};
    rebuild();
}());
