import { useEffect, useRef, useState } from 'react';
import { Link, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, getItem, getItems, type Item, type ItemPage } from './api';
import illustration from '../../assets/images/device.svg';
import LotsPanel, { formatUtc, money } from './LotsPanel';
import { clearOtherItem, findLoadedLot, getLoadedItem, rememberItem } from './loadedLots';
import { formatUnitBuyout } from './lotFilters';

type LoadState<T> = { kind: 'loading' } | { kind: 'success'; data: T } | { kind: 'error'; notFound?: boolean };

function ItemImage({ item }: { item: Item }) {
  const [failed, setFailed] = useState(false);
  return <img className="catalog-icon" src={!failed && item.iconUrl ? item.iconUrl : illustration}
    onError={() => setFailed(true)} alt="" width="80" height="64" loading="lazy" />;
}

function HomePage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('query') ?? '';
  const rawOffset = Number(params.get('offset') ?? 0);
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 && rawOffset <= 2147483647 ? rawOffset : 0;
  const active = params.has('query');
  const [state, setState] = useState<LoadState<ItemPage>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let cancelled = false;
    setState({ kind: 'loading' });
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    // Debounce typing; cleanup both aborts the request and ignores late responses.
    const debounce = window.setTimeout(() => {
      getItems(query, offset, controller.signal)
        .then(data => { if (!cancelled) setState({ kind: 'success', data }); })
        .catch(() => { if (!cancelled) setState({ kind: 'error' }); })
        .finally(() => window.clearTimeout(timeout));
    }, 250);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
      window.clearTimeout(debounce);
    };
  }, [active, query, offset, attempt]);

  return <section className="catalog" aria-labelledby="catalog-title">
    <div className="intro">
      <p className="eyebrow">АУКЦИОН STALZONE · RU</p>
      <h1 className="catalog-title" id="catalog-title">Начните с предмета</h1>
      <p className="intro-description">Найдите знакомый предмет и откройте его активные лоты аукциона региона RU.</p>
    </div>
    <form className="search-toolbar" role="search" aria-label="Поиск предметов" onSubmit={event => {
      event.preventDefault();
      setParams({ query, offset: '0' }, { replace: true });
      setAttempt(value => value + 1);
    }}>
      <div className="search-field">
        <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8.75" cy="8.75" r="5.417" /><path d="m13.333 13.333 3.75 3.75" /></svg>
        <label className="visually-hidden" htmlFor="search-input">Найти предмет по названию</label>
        <input id="search-input" type="search" placeholder="Например, Костюм" maxLength={200} value={query}
          onChange={event => setParams({ query: event.target.value, offset: '0' }, { replace: true })} />
      </div>
      <button className="button button-primary search-button" type="submit">Найти</button>
    </form>
    <div className="results-heading"><h2>Справочник предметов</h2></div>
    <div aria-live="polite" aria-busy={active && state.kind === 'loading'}>
      {!active ? <div className="empty-state"><img className="empty-illustration" src={illustration} alt="" width="80" height="64" /><h3>Какой предмет ищем?</h3><p>Введите название или его часть. Чтобы открыть весь справочник, нажмите «Найти» с пустым запросом.</p></div>
        : state.kind === 'loading' ? <p className="empty-state" role="status">Ищем предметы…</p>
        : state.kind === 'error' ? <div className="empty-state" role="alert"><h3>Не удалось загрузить предметы</h3><p>Проверьте соединение и запуск backend, затем повторите запрос.</p><button className="button button-primary" onClick={() => setAttempt(value => value + 1)}>Повторить запрос</button></div>
        : <>
          <p className="catalog-summary">Найдено предметов: {state.data.totalCount}</p>
          {state.data.items.length === 0 ? <div className="empty-state"><h3>Предметы не найдены</h3><p>Попробуйте другое название или более короткую часть слова.</p></div>
            : <ul className="catalog-results">{state.data.items.map(item => <li key={item.id}>
              <Link className="catalog-result" to={`/items/${encodeURIComponent(item.id)}`} state={{ returnTo: `/?${params.toString()}` }}>
                <ItemImage item={item} /><span className="catalog-identity"><strong>{item.name}</strong><span>{item.category} · ID: {item.id}</span></span><span aria-hidden="true">→</span>
              </Link>
            </li>)}</ul>}
          <nav className="catalog-pagination" aria-label="Страницы справочника">
            {offset > 0 && <Link className="button" to={`/?${new URLSearchParams({ query, offset: String(Math.max(0, offset - 20)) })}`}>Назад</Link>}
            {state.data.hasMore && <Link className="button button-primary" to={`/?${new URLSearchParams({ query, offset: String(offset + state.data.items.length) })}`}>Следующая страница</Link>}
          </nav>
          <p className="catalog-source">Источник: <a href={state.data.source} target="_blank" rel="noreferrer">EXBO-Studio / stalzone-database</a> · RU · ревизия {state.data.catalogRevision.slice(0, 12)}. Справочник не подтверждает наличие предмета на аукционе.</p>
        </>}
    </div>
  </section>;
}

function ItemPageView() {
  const { itemId = '' } = useParams();
  return <ItemScreen key={itemId} itemId={itemId} />;
}

function ItemScreen({ itemId }: { itemId: string }) {
  const [state, setState] = useState<LoadState<Item>>(() => {
    const item = getLoadedItem(itemId);
    return item ? { kind: 'success', data: item } : { kind: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    clearOtherItem(itemId);
    if (getLoadedItem(itemId)) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setState({ kind: 'loading' });
    getItem(itemId, controller.signal)
      .then(data => { if (!cancelled) { rememberItem(data); setState({ kind: 'success', data }); } })
      .catch(error => { if (!cancelled) setState({ kind: 'error', notFound: error instanceof ApiError && error.status === 404 }); })
      .finally(() => window.clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [itemId, attempt]);
  return <section className="item-page">
    {state.kind === 'loading' ? <p role="status">Загружаем предмет…</p>
      : state.kind === 'error' ? <><h1>{state.notFound ? 'Предмет не найден' : 'Не удалось загрузить предмет'}</h1>{!state.notFound && <button className="button button-primary" onClick={() => setAttempt(value => value + 1)}>Повторить запрос</button>}</>
      : <><div className="selected-item"><ItemImage key={state.data.id} item={state.data} /><div><h1>{state.data.name}</h1><p>{state.data.category} · ID: {state.data.id}</p></div></div></>}
    <CatalogReturn />
    {state.kind === 'success' && <LotsPanel key={itemId} itemId={itemId} itemName={state.data.name} />}
  </section>;
}

// The search URL survives browser Back and is also used for the explicit return link.
function CatalogReturn() {
  const location = useLocation();
  const returnTo: unknown = location.state?.returnTo;
  return <Link className="button button-primary" to={typeof returnTo === 'string' && returnTo.startsWith('/?') ? returnTo : '/'}>Вернуться к поиску</Link>;
}

function LotDetailsPage() {
  const { itemId = '', lotId = '' } = useParams();
  const location = useLocation();
  const loaded = findLoadedLot(itemId, lotId);
  const basePath = `/items/${encodeURIComponent(itemId)}`;
  const lotsPath = location.state?.lotsPath === `${basePath}/lots` ? `${basePath}/lots` : basePath;
  const validQuantity = loaded && Number.isSafeInteger(loaded.lot.quantity) && loaded.lot.quantity > 0;
  return <section className="lot-details" aria-labelledby="lot-details-title">
    {loaded ? <>
      <p className="eyebrow">ПОДРОБНОСТИ ЛОТА · RU</p>
      <h1 id="lot-details-title">{loaded.itemName}</h1>
      <p className="lot-warning">Предложение могло измениться или исчезнуть. Здесь показана выбранная запись из загруженного набора, без отдельного запроса актуального состояния лота.</p>
      <dl className="lot-facts">
        <div><dt>Количество</dt><dd>{validQuantity ? `${loaded.lot.quantity} шт.` : 'Некорректное количество в данных источника'}</dd></div>
        <div><dt>Начальная цена за лот</dt><dd>{money(loaded.lot.startPrice)}</dd></div>
        <div><dt>Выкуп за лот</dt><dd>{loaded.lot.buyoutPrice === null ? 'Нет выкупа' : money(loaded.lot.buyoutPrice)}</dd></div>
        <div><dt>Выкуп за единицу</dt><dd>{loaded.lot.buyoutPrice === null ? 'Не рассчитывается: нет выкупа' : !validQuantity ? 'Не рассчитывается: некорректное количество' : formatUnitBuyout(loaded.lot)}</dd></div>
        <div><dt>Текущая ставка за лот</dt><dd>{loaded.lot.currentPrice === null ? 'Не передана источником' : money(loaded.lot.currentPrice)}</dd></div>
        <div><dt>Начало (UTC)</dt><dd><time dateTime={loaded.lot.startTime}>{formatUtc(loaded.lot.startTime)}</time></dd></div>
        <div><dt>Окончание (UTC)</dt><dd><time dateTime={loaded.lot.endTime}>{formatUtc(loaded.lot.endTime)}</time></dd></div>
        <div><dt>Получено от источника (UTC)</dt><dd><time dateTime={loaded.fetchedAt}>{formatUtc(loaded.fetchedAt)}</time></dd></div>
      </dl>
      <p className="lots-note">Выкуп за единицу = выкуп за лот / количество. Два знака после запятой — только для отображения; ≈ означает округление.</p>
      <p className="lots-note">По загруженным лотам · <a href="https://eapi.stalzone.com/reference" target="_blank" rel="noreferrer">STALZONE API</a> · RU. Ключ записи временный и действует только в текущем наборе.</p>
    </> : <><h1 id="lot-details-title">Лот недоступен в загруженном наборе</h1><p>Ссылка открыта напрямую, приложение перезагружено или этой записи больше нет в текущем наборе. Стабильного ID лота в API нет: восстановить предложение по временному ключу нельзя. Вернитесь к списку и выберите загруженный лот.</p></>}
    <Link className="button button-primary" to={lotsPath} state={{ returnTo: location.state?.returnTo }}>К лотам предмета</Link>
  </section>;
}

function RouteFocus() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    document.getElementById('main')?.focus();
  }, [pathname]);
  return null;
}

function NotFoundPage() {
  return <section className="empty-state"><h1>Страница не найдена</h1><p>Проверьте адрес или вернитесь на главную.</p><Link className="button button-primary" to="/">В каталог</Link></section>;
}

export default function App() {
  return <>
    <a className="skip-link" href="#main">Перейти к содержимому</a>
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Zone Auction — главная"><span className="brand-mark" aria-hidden="true">Z</span><span>zone auction</span></Link>
      <div className="header-meta"><span className="game-name">STALZONE</span><span className="region">Регион RU</span></div>
    </header>
    <main id="main" className="container" tabIndex={-1}>
      <RouteFocus />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/items/:itemId" element={<ItemPageView />} />
        <Route path="/items/:itemId/lots" element={<ItemPageView />} />
        <Route path="/items/:itemId/lots/:lotId" element={<LotDetailsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <footer className="site-footer"><p>Неофициальный мониторинг аукциона STALZONE · RU</p><p>Официальный справочник · Данные аукциона по запросу</p></footer>
    </main>
  </>;
}
