'use client';

import {
  ActionTimeline,
  PagewayOverlay,
  PagewayProvider,
  usePageway,
} from '@zllling/pageway-react';
import '@zllling/pageway-react/styles.css';
import { Products } from './react'; // 复用上面的页面工具与上下文

function BrowserAgentStatus() {
  const { webmcp } = usePageway();
  return <output aria-label="WebMCP status">{webmcp.status}</output>;
}

export default function BrowserAgentPage() {
  return (
    <PagewayProvider webmcp={{ prefix: 'shop_' }}>
      <Products />
      <BrowserAgentStatus />
      <ActionTimeline />
      <PagewayOverlay />
    </PagewayProvider>
  );
}

// 浏览器 Agent 可发现 shop_set_sort 和 shop_get_context。
// 没有 apiOrigin/endpoint 时无需 Agent 后端，页面也不显示内置聊天。
// 依赖浏览器原生 WebMCP 支持；unsupported 不代表工具已可被外部 Agent 调用。
