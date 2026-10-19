'use client';

import { useState } from 'react';
import {
  ActionTimeline,
  PagewayChat,
  PagewayOverlay,
  PagewayProvider,
  usePageContext,
  usePageTool,
} from '@zllling/pageway-react';
import '@zllling/pageway-react/styles.css';

export default function App() {
  return (
    <PagewayProvider
      apiOrigin="/api/openai"
      model="your-tool-capable-model"
      timeoutMs={180_000}
      storageKey="my-app:current-user:pageway"
    >
      <Products />
      <PagewayChat suggestions={['把排序切换为价格从低到高']} />
      <ActionTimeline />
      <PagewayOverlay />
    </PagewayProvider>
  );
}

export function Products() {
  const [sort, setSort] = useState<'default' | 'price_asc'>('default');

  usePageContext({
    id: 'products',
    title: '商品列表',
    description: '当前商品列表的排序方式',
    data: { sort },
  });

  usePageTool<{ sort: 'default' | 'price_asc' }>({
    name: 'set_sort',
    description: '切换商品排序方式',
    parameters: {
      type: 'object',
      properties: { sort: { type: 'string', enum: ['default', 'price_asc'] } },
      required: ['sort'],
      additionalProperties: false,
    },
    target: '#product-sort',
    execute: ({ sort }) => {
      setSort(sort);
      return { sort }; // 实际结果会回传给 Agent，继续生成回复
    },
  });

  return (
    <label>
      商品排序
      <select
        id="product-sort"
        value={sort}
        onChange={(event) => setSort(event.target.value === 'price_asc' ? 'price_asc' : 'default')}
      >
        <option value="default">默认排序</option>
        <option value="price_asc">价格从低到高</option>
      </select>
    </label>
  );
}
