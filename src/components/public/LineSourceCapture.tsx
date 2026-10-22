'use client';

import * as React from 'react';
import { captureLineSource } from '@/lib/public-order-channel';

/** 不渲染任何東西：只在公開頁掛載時記下 `?src=line`（issue #1090）。 */
export function LineSourceCapture() {
  React.useEffect(() => { captureLineSource(); }, []);
  return null;
}
