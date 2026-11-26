import React, { useState } from 'react';
import {
  ArrowRightLeft,
  Coins,
  Compass,
  Package,
  ShoppingBag,
  Store,
  X,
} from 'lucide-react';
import type { FloatingWorldId, MarketCatalogPayload, NpcState, ShopItemDef } from '../types/world';

interface ShopModalProps {
  open: boolean;
  onClose: () => void;
  worldId: FloatingWorldId | string;
  coins: number;
  selectedAgent: NpcState;
  catalog: MarketCatalogPayload | null;
  onTravelMarket: () => Promise<void>;
  onBuy: (itemId: string, quantity: number) => Promise<string | null>;
  onSell: (item: string, quantity: number) => Promise<string | null>;
}

const CATEGORIES = ['All', 'Materials', 'Tools & Home', 'Food & Farm', 'Companions'] as const;

export const ShopModal: React.FC<ShopModalProps> = ({
  open,
  onClose,
  worldId,
  coins,
  selectedAgent,
  catalog,
  onTravelMarket,
  onBuy,
  onSell,
}) => {
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  if (!open) return null;

  const items: ShopItemDef[] = catalog?.shop_items ?? [];
  const sellPrices = catalog?.sell_prices ?? {};

  const filteredItems = items.filter((item) => category === 'All' || item.category === category);

  const sellableEntries = Object.entries(selectedAgent.inventory)
    .filter(([key, count]) => count > 0 && (sellPrices[key] ?? 0) > 0)
    .sort((a, b) => (sellPrices[b[0]] ?? 0) - (sellPrices[a[0]] ?? 0));

  const handleBuyClick = async (item: ShopItemDef, qty = 1) => {
    setBusyKey(`buy:${item.id}`);
    setNotice(null);
    const err = await onBuy(item.id, qty);
    if (err) {
      setNotice({ kind: 'err', text: err });
    } else {
      setNotice({
        kind: 'ok',
        text: `Bought ${item.name}${qty > 1 ? ` x${qty}` : ''} for ${item.price * qty} coins.`,
      });
    }
    setBusyKey(null);
  };

  const handleSellClick = async (key: string, qty: number) => {
    setBusyKey(`sell:${key}`);
    setNotice(null);
    const err = await onSell(key, qty);
    const earned = (sellPrices[key] ?? 0) * qty;
    if (err) {
      setNotice({ kind: 'err', text: err });
    } else {
      setNotice({
        kind: 'ok',
        text: `Sold ${qty} ${key.replace(/_/g, ' ')} for +${earned} coins.`,
      });
    }
    setBusyKey(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[86vh] flex flex-col rounded-2xl border border-white/12 bg-neutral-950/95 text-neutral-100 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <Store className="h-4 w-4 text-neutral-200" />
            </div>
            <div>
              <h2 className="text-sm font-medium tracking-tight text-white">Sky Market Shop</h2>
              <p className="text-[11px] text-neutral-400">
                Trading as {selectedAgent.name} ·{' '}
                {worldId === 'market' ? 'Docked at Sky Market Plaza' : 'Remote Order from Homestead'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-mono text-white">
              <Coins className="h-3.5 w-3.5 text-neutral-300" />
              <span>{coins}</span>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white cursor-pointer"
              aria-label="Close market shop"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Travel Prompt when not at Market */}
        {worldId !== 'market' && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-5 py-2.5 text-xs">
            <span className="text-neutral-300">
              There is a dedicated <strong>Sky Market</strong> floating world with merchant stalls & rare goods.
            </span>
            <button
              type="button"
              onClick={() => void onTravelMarket()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1 text-[11px] font-medium text-neutral-950 transition hover:bg-neutral-200 cursor-pointer"
            >
              <Compass className="h-3 w-3" />
              Travel to Sky Market
            </button>
          </div>
        )}

        {/* Tabs & Filter Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-5 pt-2.5">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setTab('buy')}
              className={`flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium transition cursor-pointer ${
                tab === 'buy'
                  ? 'border-white text-white'
                  : 'border-transparent text-neutral-500 hover:text-neutral-200'
              }`}
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              Buy Goods
            </button>
            <button
              onClick={() => setTab('sell')}
              className={`flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium transition cursor-pointer ${
                tab === 'sell'
                  ? 'border-white text-white'
                  : 'border-transparent text-neutral-500 hover:text-neutral-200'
              }`}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Sell Inventory ({sellableEntries.length})
            </button>
          </div>

          {tab === 'buy' && (
            <div className="flex flex-wrap items-center gap-1 pb-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] transition cursor-pointer ${
                    category === cat
                      ? 'bg-white font-medium text-neutral-950'
                      : 'text-neutral-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto hud-scroll p-5 space-y-3">
          {notice && (
            <div
              className={`rounded-xl border px-3 py-2 text-xs ${
                notice.kind === 'err'
                  ? 'border-white/25 bg-white/10 text-neutral-100'
                  : 'border-white/10 bg-white/[0.04] text-neutral-300'
              }`}
            >
              {notice.text}
            </div>
          )}

          {tab === 'buy' ? (
            <div className="grid sm:grid-cols-2 gap-2.5">
              {filteredItems.map((item) => {
                const canAfford = coins >= item.price;
                const isBusy = busyKey === `buy:${item.id}`;
                const ownedCount = item.grant_item ? selectedAgent.inventory[item.grant_item] ?? 0 : null;
                return (
                  <div
                    key={item.id}
                    className="flex flex-col justify-between gap-2.5 rounded-xl border border-white/10 bg-neutral-900/70 p-3 transition hover:border-white/20"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-medium text-white">{item.name}</div>
                          <div className="text-[10px] text-neutral-500">{item.category}</div>
                        </div>
                        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-neutral-200">
                          {item.price}c
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-snug text-neutral-400">{item.description}</p>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] font-mono text-neutral-500">
                        {ownedCount !== null ? `Owned: ${ownedCount}` : 'Spawns on island'}
                      </span>
                      <button
                        type="button"
                        disabled={!canAfford || busyKey !== null}
                        onClick={() => void handleBuyClick(item, 1)}
                        className="rounded-lg bg-white px-3 py-1 text-[11px] font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-40 cursor-pointer"
                      >
                        {isBusy ? 'Buying…' : canAfford ? 'Buy' : 'Need Coins'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : sellableEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-10 text-center">
              <Package className="mb-2 h-5 w-5 text-neutral-500" />
              <p className="text-xs text-neutral-400">No tradeable items in {selectedAgent.name}'s bag.</p>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                Harvest crops, berries, timber, ore, or gems on Homestead Island to sell here for coins.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sellableEntries.map(([key, count]) => {
                const price = sellPrices[key] ?? 0;
                const isBusy = busyKey === `sell:${key}`;
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-neutral-900/70 px-3.5 py-2.5"
                  >
                    <div>
                      <div className="text-xs font-medium capitalize text-white">
                        {key.replace(/_/g, ' ')}{' '}
                        <span className="font-mono text-[11px] text-neutral-400">x{count}</span>
                      </div>
                      <div className="text-[11px] text-neutral-500">{price} coins each</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => void handleSellClick(key, 1)}
                        className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-neutral-200 transition hover:bg-white/10 disabled:opacity-40 cursor-pointer"
                      >
                        {isBusy ? '…' : `Sell 1 (+${price}c)`}
                      </button>
                      {count > 1 && (
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={() => void handleSellClick(key, count)}
                          className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-40 cursor-pointer"
                        >
                          Sell All (+{price * count}c)
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
