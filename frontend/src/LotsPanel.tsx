import { useEffect, useRef, useState } from 'react';
import { ApiError, getLots, type LotPage } from './api';
import { Link } from 'react-router-dom';
import { rememberLots } from './loadedLots';
import { emptyFilterDraft, formatUnitBuyout, nextSort, selectLots, sortLabels, validateFilters, type LotSort, type SortColumn } from './lotFilters';

const sortColumns: { column: SortColumn; label: string }[] = [
  { column: 'buyout', label: 'Выкуп за лот' }, { column: 'unit', label: 'Выкуп за шт.' }, { column: 'end', label: 'Окончание (UTC)' },
];
const filterFields = [
  { key: 'min', label: 'Выкуп от' }, { key: 'max', label: 'Выкуп до' },
  { key: 'unitMin', label: 'За штуку от' }, { key: 'unitMax', label: 'За штуку до' },
] as const;

function SortButton({ column, label, sort, onSort }: { column: SortColumn; label: string; sort: LotSort; onSort: (sort: LotSort) => void }) {
  const active = sort === `${column}-asc` || sort === `${column}-desc`;
  const ascending = sort === `${column}-asc`;
  const next = nextSort(sort, column);
  return <button type="button" className={`lot-sort-button${active ? ' is-active' : ''}`} aria-pressed={active}
    title={next === 'loaded' ? 'Вернуть порядок загрузки' : sortLabels[next]} onClick={() => onSort(next)}>
    {label} <span aria-hidden="true">{active ? ascending ? '↑' : '↓' : '↕'}</span>
    <span className="visually-hidden">{active ? ascending ? ' — по возрастанию' : ' — по убыванию' : ' — сортировать'}</span>
  </button>;
}

type Operation = 'initial' | 'more' | 'refresh';
const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  timeZone: 'UTC', timeZoneName: 'short',
});
export const formatUtc = (value: string | number) => dateFormat.format(new Date(value));
// Never convert prices to Number: Int64 values can exceed JavaScript's safe integer range.
export const money = (value: string) => `${BigInt(value).toLocaleString('ru-RU')} ₽`;

// Parent keys this component by exact item ID: changing items discards the entire set.
export default function LotsPanel({ itemId, itemName }: { itemId: string; itemName: string }) {
  const [pages, setPages] = useState<LotPage[]>([]);
  const [operation, setOperation] = useState<Operation | null>('initial');
  const [failure, setFailure] = useState<{ error: Error; operation: Operation } | null>(null);
  const [retryReady, setRetryReady] = useState(true);
  const [draft, setDraft] = useState(emptyFilterDraft);
  const [appliedDraft, setAppliedDraft] = useState(emptyFilterDraft);
  const [sort, setSort] = useState<LotSort>('loaded');
  const pagesRef = useRef<LotPage[]>([]);
  const busy = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  async function load(mode: Operation) {
    if (busy.current) return;
    const previous = pagesRef.current;
    const offset = mode === 'more' ? previous.at(-1)?.nextOffset : 0;
    if (offset === null || offset === undefined) return;
    busy.current = true; // Immediate guard, including clicks before React's next render.
    const request = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 65000);
    setOperation(mode);
    setFailure(null);
    try {
      const page = await getLots(itemId, offset, abort.signal);
      if (!mounted.current || generation.current !== request) return;
      const duplicate = previous.some(old => old.pageId === page.pageId || old.offset === page.offset);
      // Do not merge different pages by a hash of fields: identical-looking lots may be distinct.
      const next = mode === 'more' ? duplicate ? previous : [...previous, page] : [page];
      pagesRef.current = next;
      rememberLots(itemId, itemName, next);
      setPages(next);
    } catch (error) {
      if (mounted.current && generation.current === request)
        setFailure({ error: error instanceof ApiError ? error : new Error('Не удалось загрузить лоты. Проверьте соединение и повторите запрос.'), operation: mode });
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && generation.current === request) { busy.current = false; setOperation(null); }
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load('initial');
    return () => {
      mounted.current = false;
      generation.current++;
      controller.current?.abort();
      busy.current = false;
    };
  }, [itemId]);

  const retryAt = failure?.error instanceof ApiError ? failure.error.retryAt : undefined;
  useEffect(() => {
    const delay = retryAt === undefined ? 0 : Math.max(0, retryAt - Date.now());
    setRetryReady(delay === 0);
    if (delay === 0) return;
    // Only enable manual controls at Retry-After; never automatically query the source.
    const timer = window.setTimeout(() => setRetryReady(true), Math.min(delay, 2147483647));
    return () => window.clearTimeout(timer);
  }, [retryAt]);

  const lots = pages.flatMap(page => page.items);
  const validation = validateFilters(draft);
  const applied = validateFilters(appliedDraft);
  // appliedDraft is updated only after successful validation; the source pages stay untouched.
  const filters = applied.valid ? applied.filters : { min: null, max: null, unitMin: null, unitMax: null, onlyBuyout: false };
  const visibleLots = selectLots(lots, filters, sort);
  const errors = validation.valid ? {} : validation.errors;
  const hasEdits = filterFields.some(({ key }) => draft[key] !== appliedDraft[key]) || draft.onlyBuyout !== appliedDraft.onlyBuyout;
  function resetFilters() {
    setDraft(emptyFilterDraft());
    setAppliedDraft(emptyFilterDraft());
  }
  const fetched = pages.map(page => Date.parse(page.fetchedAt));
  const earliest = fetched.length ? Math.min(...fetched) : null;
  const latest = fetched.length ? Math.max(...fetched) : null;
  const disabled = operation !== null || !retryReady;

  return <section className="lots-section" aria-labelledby="lots-title">
    <div className="lots-heading"><h2 id="lots-title">Активные лоты · RU</h2>
      <button className="button button-primary" disabled={disabled} onClick={() => void load('refresh')}>{operation === 'refresh' ? 'Обновляем…' : 'Обновить'}</button>
    </div>
    <div className="lots-meta">
      <p><strong>По загруженным лотам</strong> · Загружено лотов: {lots.length}</p>
      <p>Источник: <a href="https://eapi.stalzone.com/reference" target="_blank" rel="noreferrer">STALZONE API</a> · RU</p>
      <p>Получено от источника: {earliest === null || latest === null ? 'ещё не получено' : earliest === latest ? formatUtc(earliest) : `${formatUtc(earliest)} — ${formatUtc(latest)}`}</p>
    </div>
    <form className="lot-filters" aria-label="Фильтры загруженных лотов" noValidate onSubmit={event => {
      event.preventDefault();
      if (validation.valid) setAppliedDraft({ ...draft });
      else event.currentTarget.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
    }}>
      <p className="filter-description">Диапазоны выкупа за весь лот и за штуку применяются одновременно. Обрабатываются только загруженные лоты.</p>
      <div className="filter-fields">
        {filterFields.map(({ key, label }) => <div className="filter-field" key={key}>
          <label htmlFor={`buyout-${key}`}>{label}</label>
          <input id={`buyout-${key}`} type="text" inputMode="decimal" value={draft[key]} placeholder="Без ограничения" maxLength={64}
            aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `buyout-${key}-error filter-draft-notice` : 'filter-draft-notice'}
            onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))} />
          {errors[key] && <p className="filter-error" id={`buyout-${key}-error`}>{errors[key]}</p>}
        </div>)}
        <label className="filter-check"><input type="checkbox" checked={draft.onlyBuyout}
          onChange={event => setDraft(value => ({ ...value, onlyBuyout: event.target.checked }))} />Только с выкупом</label>
      </div>
      <div className="filter-actions"><button className="button button-primary" type="submit">Применить фильтры</button>
        <button className="button filter-reset" type="button" onClick={resetFilters}>Сбросить фильтры</button></div>
      <p className="filter-draft-notice" id="filter-draft-notice" role="status">{!validation.valid
        ? 'Диапазон не применён: исправьте ошибки. Показаны результаты с активными параметрами ниже.'
        : hasEdits ? 'Есть неприменённые изменения. Нажмите «Применить фильтры».' : 'Показаны результаты с активными параметрами ниже.'}</p>
    </form>
    <p className="lots-active">Активные параметры: выкуп от {filters.min?.text ?? 'без ограничения'}; выкуп до {filters.max?.text ?? 'без ограничения'};
      {' '}за штуку от {filters.unitMin?.text ?? 'без ограничения'}; за штуку до {filters.unitMax?.text ?? 'без ограничения'};
      {' '}только с выкупом: {filters.onlyBuyout ? 'да' : 'нет'}; сортировка: {sortLabels[sort]}.</p>
    <p className="lots-note">Выкуп за шт. = выкуп за лот / количество. ≈ — округлено до двух знаков только для показа; фильтры и сортировка используют точное значение.</p>
    <p className="lots-note">Сортировка стрелками: возрастание → убывание → порядок загрузки.</p>
    <div className="lots-mobile-sort" role="group" aria-label="Сортировка загруженных лотов">
      {sortColumns.map(props => <SortButton key={props.column} {...props} sort={sort} onSort={setSort} />)}
    </div>
    <p className="lots-shown" role="status">Показано {visibleLots.length} из {lots.length} загруженных</p>
    <div aria-live="polite" aria-busy={operation !== null}>
      {operation === 'initial' && <p className="empty-state" role="status">Загружаем лоты…</p>}
      {failure && <div className="lots-error" role="alert">
        <h3>{failure.error instanceof ApiError && failure.error.status === 429 ? 'Ограничение запросов' : 'Не удалось загрузить лоты'}</h3>
        <p>{failure.error.message}</p>
        {pages.length > 0 && <p>{failure.operation === 'refresh' ? 'Обновление не удалось. Показан прежний набор с прежним временем получения.' : 'Сохранены ранее загруженные страницы.'}</p>}
        {retryAt !== undefined && <p>Повтор доступен после {formatUtc(retryAt)}.</p>}
        <button className="button button-primary" disabled={disabled} onClick={() => void load(failure.operation)}>Повторить запрос лотов</button>
      </div>}
      {pages.length > 0 && lots.length === 0 && <div className="empty-state"><h3>Лотов нет</h3><p>Источник не вернул активных предложений для этого предмета.</p></div>}
      {lots.length > 0 && visibleLots.length === 0 && <div className="empty-state"><h3>Нет лотов по выбранным фильтрам</h3>
        <p>Измените фильтры или загрузите следующую страницу, если она доступна.</p>
        <button className="button button-primary" type="button" onClick={resetFilters}>Сбросить фильтры</button></div>}
      {visibleLots.length > 0 && <table className="lots-table">
        <caption className="visually-hidden">Загруженные лоты: начальная цена и выкуп за весь лот, отдельно выкуп за штуку.</caption>
        <thead><tr><th scope="col">Количество</th><th scope="col">Начальная цена</th>
          {sortColumns.map(props => <th key={props.column} scope="col" aria-sort={sort === `${props.column}-asc` ? 'ascending' : sort === `${props.column}-desc` ? 'descending' : 'none'}>
            <SortButton {...props} sort={sort} onSort={setSort} />
          </th>)}
          <th scope="col"><span className="visually-hidden">Подробности</span></th></tr></thead>
        <tbody>{visibleLots.map(lot => <tr key={lot.id}>
          <td data-label="Количество">{lot.quantity} шт.</td>
          <td data-label="Начальная цена">{money(lot.startPrice)}</td>
          <td data-label="Выкуп за лот">{lot.buyoutPrice === null ? 'Нет выкупа' : money(lot.buyoutPrice)}</td>
          <td data-label="Выкуп за шт.">{formatUnitBuyout(lot)}</td>
          <td data-label="Окончание (UTC)"><time dateTime={lot.endTime}>{formatUtc(lot.endTime)}</time></td>
          <td data-label="Подробности"><Link to={`/items/${encodeURIComponent(itemId)}/lots/${encodeURIComponent(lot.id)}`}>Подробнее о лоте</Link></td>
        </tr>)}</tbody>
      </table>}
      {operation === 'more' && <p className="lots-progress" role="status">Загружаем ещё лоты…</p>}
      {operation === 'refresh' && <p className="lots-progress" role="status">Обновляем набор с первой страницы…</p>}
    </div>
    {pages.at(-1)?.hasMore && <button className="button button-primary lots-more" disabled={disabled} onClick={() => void load('more')}>Загрузить ещё</button>}
    <p className="lots-note">Аукцион меняется: страницы получены в разное время. Без стабильного ID источник не позволяет точно убрать пересечения между страницами. Возможна выдача из краткого серверного кэша.</p>
  </section>;
}
