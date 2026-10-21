import { useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { getHealth } from './api';
import illustration from '../../assets/images/device.svg';

function BackendStatus() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setStatus('loading');
    getHealth(controller.signal)
      .then(() => { if (!cancelled) setStatus('ok'); })
      .catch(() => { if (!cancelled) setStatus('error'); })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [attempt]);

  return (
    <div className="backend-status">
      <p role="status">
        {status === 'loading' && 'Проверяем связь с сервером…'}
        {status === 'ok' && 'Наш сервер доступен. Данные аукциона ещё не подключены.'}
        {status === 'error' && 'Наш сервер недоступен. Проверьте запуск backend.'}
      </p>
      {status === 'error' && <button type="button" className="button button-primary" onClick={() => setAttempt(value => value + 1)}>Повторить проверку</button>}
    </div>
  );
}

function HomePage() {
  return (
    <section className="catalog" aria-labelledby="catalog-title">
      <div className="intro">
        <p className="eyebrow">АУКЦИОН STALZONE</p>
        <h1 className="catalog-title" id="catalog-title">Предметы. Цены. Ничего лишнего.</h1>
        <p className="intro-description">Здесь можно будет искать предметы и сравнивать лоты аукциона региона RU.</p>
      </div>
      <div className="search-toolbar" role="search" aria-label="Поиск предметов">
        <div className="search-field">
          <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8.75" cy="8.75" r="5.417" /><path d="m13.333 13.333 3.75 3.75" /></svg>
          <label className="visually-hidden" htmlFor="search-input">Найти предмет по названию</label>
          <input id="search-input" type="search" placeholder="Найти предмет по названию" disabled aria-describedby="catalog-notice" />
        </div>
        <button className="button button-primary search-button" type="button" disabled>Найти</button>
      </div>
      <div className="categories" aria-label="Будущие категории предметов">
        {['Все предметы', 'Оружие', 'Броня', 'Артефакты', 'Снаряжение'].map((name, index) => (
          <button key={name} type="button" className={`category${index === 0 ? ' is-active' : ''}`} disabled>{name}</button>
        ))}
      </div>
      <div className="results-heading"><h2>Каталог предметов</h2><p className="results-count">Подключение готовится</p></div>
      <div className="empty-state" id="catalog-notice">
        <img className="empty-illustration" src={illustration} alt="" width="80" height="64" />
        <h3>Данные ещё не подключены</h3>
        <p>Поиск станет доступен после подключения официального справочника. Актуальные лоты и цены появятся после подключения серверного API. Сейчас рыночные данные не загружены.</p>
      </div>
      <BackendStatus />
    </section>
  );
}

function PendingPage() {
  return <section className="empty-state"><h1>Лоты ещё не подключены</h1><p>Данные предмета и лотов будут загружаться через наш сервер. На этом этапе они недоступны.</p><Link className="button button-primary" to="/">Вернуться в каталог</Link></section>;
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
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/items/:itemId/lots" element={<PendingPage />} />
        <Route path="/items/:itemId/lots/:lotId" element={<PendingPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <footer className="site-footer"><p>Неофициальный мониторинг аукциона STALZONE · RU</p><p>Начальная версия · Данные не подключены</p></footer>
    </main>
  </>;
}
