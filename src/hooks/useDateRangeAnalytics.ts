import { useCallback, useEffect, useState } from 'react';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import {
  fetchFeedConsumptionByDateRange,
  fetchFeedPurchasesByDateRange,
  subscribeFeedConsumptionByDateRange,
  subscribeFeedPurchasesByDateRange,
} from '../services/feedService.ts';
import {
  fetchEggProductionByDateRange,
  subscribeEggProductionByDateRange,
} from '../services/productionService.ts';
import {
  fetchEggSalesByDateRange,
  subscribeEggSalesByDateRange,
} from '../services/salesService.ts';
import type {
  DateFilterPreset,
  EggProductionEntry,
  EggSale,
  FeedConsumption,
  FeedPurchase,
} from '../types/farm.ts';

interface UseDateRangeAnalyticsParams {
  farmId: string;
  preset: DateFilterPreset;
  startDate: string;
  endDate: string;
  canReadProd: boolean;
  canReadFeed: boolean;
  canReadSales: boolean;
  includePurchases?: boolean;
}

interface UseDateRangeAnalyticsResult {
  production: EggProductionEntry[];
  purchases: FeedPurchase[];
  consumptions: FeedConsumption[];
  sales: EggSale[];
  isFetching: boolean;
  fetchError: string | null;
  refetch: () => void;
}

export function useDateRangeAnalytics({
  farmId,
  preset,
  startDate,
  endDate,
  canReadProd,
  canReadFeed,
  canReadSales,
  includePurchases = false,
}: UseDateRangeAnalyticsParams): UseDateRangeAnalyticsResult {
  const [production, setProduction] = useState<EggProductionEntry[]>([]);
  const [purchases, setPurchases] = useState<FeedPurchase[]>([]);
  const [consumptions, setConsumptions] = useState<FeedConsumption[]>([]);
  const [sales, setSales] = useState<EggSale[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchVersion, setFetchVersion] = useState(0);

  const refetch = useCallback(() => {
    setFetchVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!farmId || !startDate || !endDate) {
      setIsFetching(false);
      return;
    }

    let cancelled = false;
    const unsubs: (() => void)[] = [];

    const onStreamError = (err: Error) => {
      if (!cancelled) {
        setFetchError(formatUserFriendlyError(err));
      }
    };

    const run = async () => {
      setIsFetching(true);
      setFetchError(null);

      try {
        const [prodRows, purchaseRows, consRows, saleRows] = await Promise.all([
          canReadProd
            ? fetchEggProductionByDateRange(farmId, startDate, endDate)
            : Promise.resolve<EggProductionEntry[]>([]),
          canReadFeed && includePurchases
            ? fetchFeedPurchasesByDateRange(farmId, startDate, endDate)
            : Promise.resolve<FeedPurchase[]>([]),
          canReadFeed
            ? fetchFeedConsumptionByDateRange(farmId, startDate, endDate)
            : Promise.resolve<FeedConsumption[]>([]),
          canReadSales
            ? fetchEggSalesByDateRange(farmId, startDate, endDate)
            : Promise.resolve<EggSale[]>([]),
        ]);

        if (cancelled) return;

        setProduction(prodRows);
        setPurchases(purchaseRows);
        setConsumptions(consRows);
        setSales(saleRows);
        setIsFetching(false);

        if (canReadProd) {
          unsubs.push(
            subscribeEggProductionByDateRange(
              farmId,
              startDate,
              endDate,
              (rows) => {
                if (!cancelled) setProduction(rows);
              },
              onStreamError
            )
          );
        }
        if (canReadFeed && includePurchases) {
          unsubs.push(
            subscribeFeedPurchasesByDateRange(
              farmId,
              startDate,
              endDate,
              (rows) => {
                if (!cancelled) setPurchases(rows);
              },
              onStreamError
            )
          );
        }
        if (canReadFeed) {
          unsubs.push(
            subscribeFeedConsumptionByDateRange(
              farmId,
              startDate,
              endDate,
              (rows) => {
                if (!cancelled) setConsumptions(rows);
              },
              onStreamError
            )
          );
        }
        if (canReadSales) {
          unsubs.push(
            subscribeEggSalesByDateRange(
              farmId,
              startDate,
              endDate,
              (rows) => {
                if (!cancelled) setSales(rows);
              },
              onStreamError
            )
          );
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(formatUserFriendlyError(err));
          setIsFetching(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [
    farmId,
    preset,
    startDate,
    endDate,
    canReadProd,
    canReadFeed,
    canReadSales,
    includePurchases,
    fetchVersion,
  ]);

  return {
    production,
    purchases,
    consumptions,
    sales,
    isFetching,
    fetchError,
    refetch,
  };
}
