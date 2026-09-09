// The Figma reference displays 11 content cards per page.
export const CONTENT_PAGE_SIZE = 11;

export function getContentPage(total: number, requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(total / CONTENT_PAGE_SIZE));
  const currentPage = Math.max(1, Math.min(requestedPage, pageCount));
  const offset = (currentPage - 1) * CONTENT_PAGE_SIZE;
  const pageNumbers = Array.from(
    new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount]),
  )
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((left, right) => left - right);
  return {
    pageCount,
    currentPage,
    offset,
    end: offset + CONTENT_PAGE_SIZE,
    pageNumbers,
  };
}
