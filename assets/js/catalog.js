const form = document.querySelector('#search-form');
const input = document.querySelector('#search-input');
const list = document.querySelector('#item-list');
const items = Array.from(list.children);
const categories = Array.from(document.querySelectorAll('button[data-category]'));
const sort = document.querySelector('#sort');
const count = document.querySelector('#results-count');
const emptyState = document.querySelector('#empty-state');
let activeCategory = 'all';

function updateCatalog() {
  const query = input.value.trim().toLocaleLowerCase('ru');
  const ordered = [...items];

  if (sort.value !== 'popular') {
    const direction = sort.value === 'price-asc' ? 1 : -1;
    ordered.sort((a, b) => (Number(a.dataset.price) - Number(b.dataset.price)) * direction);
  }

  let visibleCount = 0;
  for (const item of ordered) {
    const matchesCategory = activeCategory === 'all' || item.dataset.category === activeCategory;
    const matchesQuery = item.querySelector('h3').textContent.toLocaleLowerCase('ru').includes(query);
    item.hidden = !(matchesCategory && matchesQuery);
    if (!item.hidden) visibleCount += 1;
    list.append(item);
  }

  const ending = visibleCount === 1 ? 'предмет' : visibleCount >= 2 && visibleCount <= 4 ? 'предмета' : 'предметов';
  count.textContent = `${visibleCount} ${ending}`;
  emptyState.hidden = visibleCount !== 0;
  list.hidden = visibleCount === 0;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  updateCatalog();
});

input.addEventListener('input', updateCatalog);
sort.addEventListener('change', updateCatalog);

for (const category of categories) {
  category.addEventListener('click', () => {
    activeCategory = category.dataset.category;
    for (const button of categories) {
      const selected = button === category;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    updateCatalog();
  });
}

document.querySelector('#reset-filters').addEventListener('click', () => {
  input.value = '';
  sort.value = 'popular';
  categories[0].click();
  input.focus();
});
