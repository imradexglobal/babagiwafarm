import { useCallback, useEffect, useState } from 'react';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import { beginFirebaseSync } from '../lib/firebaseSync.ts';
import {
  fetchEnvironmentLogsByDateRange,
  fetchMedicationLogsByDateRange,
  subscribeEnvironmentLogsByDateRange,
  subscribeMedicationLogsByDateRange,
} from '../services/dailyRecordsService.ts';
import {
  fetchFeedConsumptionByDateRange,
  fetchFeedPurchasesByDateRange,
  subscribeFeedConsumptionByDateRange,
  subscribeFeedPurchasesByDateRange,
} from '../services/feedService.ts';
import {
  fetchMortalityByDateRange,
  subscribeMortalityByDateRange,
} from '../services/mortalityService.ts';
import {
  fetchEggProductionByDateRange,
  subscribeEggProductionByDateRange,
} from '../services/productionService.ts';
import {
  fetchFarmPurchasesByDateRange,
  subscribeFarmPurchasesByDateRange,
} from '../services/purchasesService.ts';
import {
  fetchEggSalesByDateRange,
  subscribeEggSalesByDateRange,
} from '../services/salesService.ts';
import type {
  DateFilterPreset,
  EggProductionEntry,
  EggSale,
  EnvironmentMetricLog,
  FarmPurchase,
  FeedConsumption,
  FeedPurchase,
  MedicationLog,
  MortalityEntry,
} from '../types/farm.ts';

interface UseDateRangeAnalyticsParams {
  farmId: string;
  preset: DateFilterPreset;
  startDate: string;
  endDate: string;
  canReadProd: boolean;
  canReadFeed: boolean;
  canReadSales: boolean;
  canReadMortality?: boolean;
  canReadMedication?: boolean;
  canReadEnvironment?: boolean;
  canReadFarmPurchases?: boolean;
  includePurchases?: boolean;
}

interface UseDateRangeAnalyticsResult {
  production: EggProductionEntry[];
  purchases: FeedPurchase[];
  farmPurchases: FarmPurchase[];
  consumptions: FeedConsumption[];
  sales: EggSale[];
  mortality: MortalityEntry[];
  medicationLogs: MedicationLog[];
  environmentLogs: EnvironmentMetricLog[];
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
  canReadMortality = false,
  canReadMedication = false,
  canReadEnvironment = false,
  canReadFarmPurchases = false,
  includePurchases = false,
}: UseDateRangeAnalyticsParams): UseDateRangeAnalyticsResult {
  const [production, setProduction] = useState<EggProductionEntry[]>([]);
  const [purchases, setPurchases] = useState<FeedPurchase[]>([]);
  const [farmPurchases, setFarmPurchases] = useState<FarmPurchase[]>([]);
  const [consumptions, setConsumptions] = useState<FeedConsumption[]>([]);
  const [sales, setSales] = useState<EggSale[]>([]);
  const [mortality, setMortality] = useState<MortalityEntry[]>([]);
  const [medicationLogs, setMedicationLogs] = useState<MedicationLog[]>([]);
  const [environmentLogs, setEnvironmentLogs] = useState<EnvironmentMetricLog[]>([]);
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
    const endSync = beginFirebaseSync();

    const onStreamError = (err: Error) => {
      if (!cancelled) {
        setFetchError(formatUserFriendlyError(err));
      }
    };

    const run = async () => {
      setIsFetching(true);
      setFetchError(null);

      try {
        const [
          prodRows,
          purchaseRows,
          farmPurchaseRows,
          consRows,
          saleRows,
          mortalityRows,
          medRows,
          envRows,
        ] = await Promise.all([
          canReadProd
            ? fetchEggProductionByDateRange(farmId, startDate, endDate)
            : Promise.resolve<EggProductionEntry[]>([]),
          canReadFeed && includePurchases
            ? fetchFeedPurchasesByDateRange(farmId, startDate, endDate)
            : Promise.resolve<FeedPurchase[]>([]),
          canReadFarmPurchases
            ? fetchFarmPurchasesByDateRange(farmId, startDate, endDate)
            : Promise.resolve<FarmPurchase[]>([]),
          canReadFeed
            ? fetchFeedConsumptionByDateRange(farmId, startDate, endDate)
            : Promise.resolve<FeedConsumption[]>([]),
          canReadSales
            ? fetchEggSalesByDateRange(farmId, startDate, endDate)
            : Promise.resolve<EggSale[]>([]),
          canReadMortality
            ? fetchMortalityByDateRange(farmId, startDate, endDate)
            : Promise.resolve<MortalityEntry[]>([]),
          canReadMedication
            ? fetchMedicationLogsByDateRange(farmId, startDate, endDate)
            : Promise.resolve<MedicationLog[]>([]),
          canReadEnvironment
            ? fetchEnvironmentLogsByDateRange(farmId, startDate, endDate)
            : Promise.resolve<EnvironmentMetricLog[]>([]),
        ]);

        if (cancelled) return;

        setProduction(prodRows);
        setPurchases(purchaseRows);
        setFarmPurchases(farmPurchaseRows);
        setConsumptions(consRows);
        setSales(saleRows);
        setMortality(mortalityRows);
        setMedicationLogs(medRows);
        setEnvironmentLogs(envRows);
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
        if (canReadFarmPurchases) {
          unsubs.push(
            subscribeFarmPurchasesByDateRange(
              farmId,
              startDate,
              endDate,
              (rows) => {
                if (!cancelled) setFarmPurchases(rows);
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
        if (canReadMortality) {
          unsubs.push(
            subscribeMortalityByDateRange(
              farmId,
              startDate,
              endDate,
              (rows) => {
                if (!cancelled) setMortality(rows);
              },
              onStreamError
            )
          );
        }
        if (canReadMedication) {
          unsubs.push(
            subscribeMedicationLogsByDateRange(
              farmId,
              startDate,
              endDate,
              (rows) => {
                if (!cancelled) setMedicationLogs(rows);
              },
              onStreamError
            )
          );
        }
        if (canReadEnvironment) {
          unsubs.push(
            subscribeEnvironmentLogsByDateRange(
              farmId,
              startDate,
              endDate,
              (rows) => {
                if (!cancelled) setEnvironmentLogs(rows);
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
      } finally {
        endSync();
      }
    };

    void run();

    return () => {
      cancelled = true;
      endSync();
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
    canReadMortality,
    canReadMedication,
    canReadEnvironment,
    canReadFarmPurchases,
    includePurchases,
    fetchVersion,
  ]);

  return {
    production,
    purchases,
    farmPurchases,
    consumptions,
    sales,
    mortality,
    medicationLogs,
    environmentLogs,
    isFetching,
    fetchError,
    refetch,
  };
}
