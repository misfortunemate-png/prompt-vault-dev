import { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '../lib/api';

export default function TagSuggest({ value, onChange, style, ...rest }) {
  const [suggestions, setSuggestions] = useState([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const textareaRef = useRef(null);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  const getCurrentToken = () => {
    const el = textareaRef.current;
    if (!el) return '';
    const before = el.value.slice(0, el.selectionStart);
    const parts = before.split(',');
    return parts[parts.length - 1].trim();
  };

  const handleInput = useCallback((e) => {
    onChange(e.target.value);
    clearTimeout(debounceRef.current);

    const token = getCurrentToken();
    if (token.length < 2) {
      setSuggestions([]);
      setActiveIdx(-1);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const results = await api.searchTags(token);
        setSuggestions(results.slice(0, 10));
        setActiveIdx(-1);
      } catch {
        setSuggestions([]);
      }
    }, 300);
  }, [onChange]);

  const handleSelect = useCallback((tag) => {
    const el = textareaRef.current;
    if (!el) return;

    const pos = el.selectionStart;
    const before = el.value.slice(0, pos);
    const after = el.value.slice(pos);

    const lastComma = before.lastIndexOf(',');
    const prefix = lastComma === -1 ? '' : before.slice(0, lastComma + 1) + ' ';
    const newValue = prefix + tag + ', ' + after.trimStart();
    onChange(newValue);

    const newPos = prefix.length + tag.length + 2;
    setSuggestions([]);
    setActiveIdx(-1);

    setTimeout(() => {
      el.focus();
      el.setSelectionRange(newPos, newPos);
    }, 0);
  }, [onChange]);

  const handleKeyDown = (e) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); handleSelect(suggestions[activeIdx]); }
    else if (e.key === 'Escape') { setSuggestions([]); setActiveIdx(-1); }
  };

  useEffect(() => {
    const onOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setSuggestions([]);
        setActiveIdx(-1);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        style={{ width: '100%', boxSizing: 'border-box', ...style }}
        {...rest}
      />
      {suggestions.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-s)',
          zIndex: 200,
          maxHeight: '200px',
          overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {suggestions.map((tag, i) => (
            <div
              key={tag}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(tag); }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: 'var(--fs-label)',
                fontFamily: 'monospace',
                background: i === activeIdx ? 'var(--accent)' : 'transparent',
                color: i === activeIdx ? 'var(--accent-contrast)' : 'var(--text-primary)',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--line)' : 'none',
              }}
            >
              {tag}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
