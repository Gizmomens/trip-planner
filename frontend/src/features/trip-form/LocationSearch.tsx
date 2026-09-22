import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { api, errorMessage } from '../../lib/api';
import type { Location, LocationField } from '../../types';

interface Props {
  field: LocationField;
  label: string;
  number: string;
  placeholder: string;
  selected: Location | null;
  onChange: (location: Location | null) => void;
  error?: string;
  enabled: boolean;
}

export function LocationSearch({
  field,
  label,
  number,
  placeholder,
  selected,
  onChange,
  error,
  enabled,
}: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const resultsList = useRef<HTMLUListElement>(null);
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Location[]>([]);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const visibleError = error || lookupError;

  useEffect(
    () => () => {
      version.current++;
      controller.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const list = resultsList.current;
    if (!open || active < 0 || !list) return;
    const option = list.children.item(active);
    if (!(option instanceof HTMLElement)) return;

    const viewportTop = list.getBoundingClientRect().top + list.clientTop;
    const viewportBottom = viewportTop + list.clientHeight;
    const optionBounds = option.getBoundingClientRect();
    if (optionBounds.top < viewportTop) {
      list.scrollTop += optionBounds.top - viewportTop;
    } else if (optionBounds.bottom > viewportBottom) {
      list.scrollTop += optionBounds.bottom - viewportBottom;
    }
  }, [active, open]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!enabled || selected || trimmedQuery.length < 3) return;

    const currentVersion = ++version.current;
    const request = new AbortController();
    controller.current = request;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setLookupError('');
      try {
        const response = await api.locations(trimmedQuery, request.signal);
        if (currentVersion !== version.current || request.signal.aborted) return;
        const selectable = response.locations.filter((location) => Boolean(location.token));
        setResults(selectable);
        setSearched(true);
        setOpen(true);
        setActive(-1);
      } catch (failure) {
        if (currentVersion === version.current && !request.signal.aborted) {
          setLookupError(errorMessage(failure));
        }
      } finally {
        if (currentVersion === version.current) {
          setLoading(false);
          controller.current = null;
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      request.abort();
      if (controller.current === request) controller.current = null;
    };
  }, [enabled, query, selected]);

  function invalidate() {
    version.current++;
    controller.current?.abort();
    controller.current = null;
    setLoading(false);
    setResults([]);
    setActive(-1);
    setOpen(false);
    setSearched(false);
    setLookupError('');
  }

  function choose(location: Location) {
    invalidate();
    setQuery(location.name);
    onChange(location);
    input.current?.focus();
  }

  function clear() {
    invalidate();
    setQuery('');
    onChange(null);
    input.current?.focus();
  }

  return (
    <div className={`location-field location-${field}`}>
      <label htmlFor={id}>
        <span className="field-number">{number}</span>
        {label}
        <span className="required-mark" aria-hidden="true">
          *
        </span>
      </label>
      <div
        className={`search-control ${selected ? 'is-selected' : ''} ${visibleError ? 'is-invalid' : ''}`}
      >
        <input
          ref={input}
          id={id}
          name={field}
          role="combobox"
          type="text"
          autoComplete="off"
          required
          maxLength={200}
          placeholder={placeholder}
          value={query}
          aria-autocomplete="list"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-results`}
          aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
          aria-invalid={Boolean(visibleError)}
          aria-describedby={`${id}-hint${visibleError ? ` ${id}-error` : ''}`}
          onChange={(event) => {
            invalidate();
            setQuery(event.target.value);
            onChange(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              setActive(-1);
            }
            if (event.key === 'ArrowDown' && results.length) {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.min(index + 1, results.length - 1));
            }
            if (event.key === 'ArrowUp' && results.length) {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.max(index - 1, 0));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const choice = open && active >= 0 ? results[active] : undefined;
              if (choice) choose(choice);
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="location-clear-button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={clear}
          >
            <Icon name="close" size={17} />
          </button>
        )}
      </div>
      <p className={selected ? 'selection-hint' : 'field-hint'} id={`${id}-hint`}>
        {selected ? (
          <>
            <Icon name="check" size={14} />
            <span>{selected.address || 'Location confirmed'}</span>
          </>
        ) : (
          'Type at least 3 characters and select a matching location.'
        )}
      </p>
      {visibleError && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {visibleError}
        </p>
      )}
      <div className="sr-only" role="status">
        {loading
          ? `Searching ${label.toLowerCase()}.`
          : searched
            ? `${results.length} matches. Use up and down arrows, then Enter to select.`
            : ''}
      </div>
      <ul
        ref={resultsList}
        id={`${id}-results`}
        className="location-results"
        role="listbox"
        aria-label={`${label} results`}
        hidden={!open || results.length === 0}
      >
        {results.map((location, index) => (
          <li
            key={`${location.id}-${index}`}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={active === index}
            className={active === index ? 'active' : ''}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(location)}
          >
            <Icon name="pin" size={17} />
            <span>
              <strong>{location.name}</strong>
              <small>{location.address || 'Address not supplied'}</small>
            </span>
          </li>
        ))}
      </ul>
      {searched && results.length === 0 && (
        <p className="field-hint" role="status">
          No selectable matches. Try a city, state, or a more specific address in the contiguous US.
        </p>
      )}
    </div>
  );
}
