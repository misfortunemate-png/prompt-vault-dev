import { useState, useRef, useEffect } from 'react';

export default function TagInput({ tags = [], onChange, allTags = [], placeholder = 'タグを入力…' }) {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const addTag = (tag) => {
    const t = tag.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInputValue('');
    setSuggestions([]);
  };

  const removeTag = (tag) => onChange(tags.filter(t => t !== tag));

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (inputValue.trim()) addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === 'Escape') {
      setSuggestions([]);
    }
  };

  const handleChange = (e) => {
    const v = e.target.value;
    setInputValue(v);
    if (v.trim()) {
      const filtered = allTags.filter(t => t.toLowerCase().includes(v.toLowerCase()) && !tags.includes(t));
      setSuggestions(filtered.slice(0, 5));
    } else {
      setSuggestions([]);
    }
  };

  useEffect(() => {
    const onOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setSuggestions([]);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  return (
    <div ref={containerRef}>
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
          {tags.map(tag => (
            <span key={tag} style={{
              background: 'var(--accent)', color: 'var(--accent-contrast)',
              padding: '2px 8px', borderRadius: '99px',
              fontSize: 'var(--fs-label)',
              display: 'inline-flex', alignItems: 'center', gap: '4px',
            }}>
              {tag}
              <button
                onClick={() => removeTag(tag)}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1 }}
              >×</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 10px',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-s)',
            background: 'var(--bg)',
            color: 'var(--text-primary)',
            fontSize: 'var(--fs-label)',
          }}
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
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}>
            {suggestions.map(tag => (
              <div
                key={tag}
                onMouseDown={(e) => { e.preventDefault(); addTag(tag); }}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: 'var(--fs-label)',
                  borderBottom: '1px solid var(--line)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {tag}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
