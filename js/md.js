/* Tiny, safe Markdown renderer (no dependencies, works on old phones).
   Everything is HTML-escaped first, then only our own tags are produced. */
(function (root) {
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function safeUrl(u) { return /^(https?:\/\/|mailto:)/i.test(u) ? u : ''; }

  function emphasis(s) {
    return s
      .replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^\n]+?)__/g, '<strong>$1</strong>')
      .replace(/~~([^\n]+?)~~/g, '<del>$1</del>')
      .replace(/(^|[^*\w])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_([^\s_](?:[^_\n]*[^\s_])?)_(?!\w)/g, '$1<em>$2</em>');
  }

  function inline(raw) {
    var keep = [];
    function hold(html) { keep.push(html); return '\u0001' + (keep.length - 1) + '\u0001'; }
    var s = String(raw);
    s = s.replace(/`([^`\n]+)`/g, function (m, c) { return hold('<code>' + esc(c) + '</code>'); });
    s = s.replace(/\[([^\]\n]+)\]\((\S+?)\)/g, function (m, t, u) {
      var url = safeUrl(u.replace(/&amp;/g, '&'));
      if (!url) return m;
      return hold('<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + emphasis(esc(t)) + '</a>');
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, function (m, pre, u) {
      return pre + hold('<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u) + '</a>');
    });
    s = emphasis(esc(s).replace(/&#39;/g, "'"));
    return s.replace(/\u0001(\d+)\u0001/g, function (m, i) { return keep[+i]; });
  }

  var RE = {
    fence: /^\s*(```|~~~)\s*([\w+#.-]*)[^\n]*$/,
    head: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
    quote: /^\s*>\s?(.*)$/,
    li: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
    tsep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
  };

  function cells(line) {
    line = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return line.split('|').map(function (c) { return c.trim().replace(/\\$/, ''); });
  }
  function isBlockStart(l, next) {
    return RE.fence.test(l) || RE.head.test(l) || RE.hr.test(l) || RE.quote.test(l) || RE.li.test(l) ||
      (l.indexOf('|') >= 0 && next !== undefined && RE.tsep.test(next) && next.indexOf('-') >= 0);
  }

  function list(items) {
    var html = '', stack = [];
    items.forEach(function (it) {
      var tag = /\d/.test(it.mark.charAt(0)) ? 'ol' : 'ul';
      while (stack.length && it.indent < stack[stack.length - 1].indent) { html += '</li></' + stack.pop().tag + '>'; }
      var top = stack[stack.length - 1];
      if (!top || it.indent > top.indent) { html += '<' + tag + '><li>'; stack.push({ indent: it.indent, tag: tag }); }
      else if (top.tag !== tag) { html += '</li></' + stack.pop().tag + '><' + tag + '><li>'; stack.push({ indent: it.indent, tag: tag }); }
      else { html += '</li><li>'; }
      html += inline(it.text);
    });
    while (stack.length) html += '</li></' + stack.pop().tag + '>';
    return html;
  }

  function render(src) {
    src = String(src || '').replace(/\r\n?/g, '\n').replace(/[\u0000\u0001]/g, '');
    var L = src.split('\n'), out = [], i = 0, m;
    while (i < L.length) {
      var line = L[i];
      if (!line.trim()) { i++; continue; }

      if ((m = line.match(RE.fence))) {                       // fenced code (also while still streaming)
        var mark = m[1], lang = m[2], code = [];
        i++;
        while (i < L.length && L[i].trim().indexOf(mark) !== 0) code.push(L[i++]);
        i++;
        out.push('<pre><code' + (lang ? ' class="language-' + esc(lang) + '" data-lang="' + esc(lang) + '"' : '') + '>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      if ((m = line.match(RE.head))) { var n = Math.min(6, m[1].length + 1); out.push('<h' + n + '>' + inline(m[2]) + '</h' + n + '>'); i++; continue; }
      if (RE.hr.test(line)) { out.push('<hr>'); i++; continue; }

      if (RE.quote.test(line)) {
        var q = [];
        while (i < L.length && RE.quote.test(L[i])) q.push(L[i++].replace(RE.quote, '$1'));
        out.push('<blockquote>' + render(q.join('\n')) + '</blockquote>');
        continue;
      }
      if (line.indexOf('|') >= 0 && i + 1 < L.length && RE.tsep.test(L[i + 1]) && L[i + 1].indexOf('-') >= 0) {
        var head = cells(line), rows = [];
        i += 2;
        while (i < L.length && L[i].trim() && L[i].indexOf('|') >= 0) rows.push(cells(L[i++]));
        out.push('<div class="tbl"><table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + head.map(function (_, k) { return '<td>' + inline(r[k] || '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      if ((m = line.match(RE.li))) {
        var items = [];
        while (i < L.length) {
          var lm = L[i].match(RE.li);
          if (lm) { items.push({ indent: lm[1].replace(/\t/g, '    ').length, mark: lm[2], text: lm[3] }); i++; }
          else if (L[i].trim() && /^\s+\S/.test(L[i]) && items.length) { items[items.length - 1].text += '\n' + L[i].trim(); i++; }
          else if (!L[i].trim() && i + 1 < L.length && RE.li.test(L[i + 1])) { i++; }
          else break;
        }
        // normalise indents to levels
        var levels = [];
        items.forEach(function (it) {
          while (levels.length && it.indent < levels[levels.length - 1]) levels.pop();
          if (!levels.length || it.indent > levels[levels.length - 1]) levels.push(it.indent);
          it.indent = levels.length;
        });
        out.push(list(items).replace(/\n/g, '<br>'));
        continue;
      }
      var p = [];
      while (i < L.length && L[i].trim() && !(p.length && isBlockStart(L[i], L[i + 1]))) p.push(L[i++]);
      out.push('<p>' + p.map(inline).join('<br>') + '</p>');
    }
    return out.join('');
  }

  var api = { render: render, esc: esc };
  root.MD = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
