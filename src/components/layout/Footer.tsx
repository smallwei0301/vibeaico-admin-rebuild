import { common } from '@/i18n/zh-TW/common';

export function Footer() {
  return (
    <footer className="px-content py-4 text-center text-xs text-secondary">
      {common.copyright}
    </footer>
  );
}
