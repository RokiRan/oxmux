import type { ExecutorRecord } from '@shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { api } from './api'
import { workspaceQueryKeys } from './workspace-query-keys'

const EXECUTORS_CACHE_TTL_MS = 30_000

const loadExecutors = async () => {
  const response = await api.listExecutors()
  return response.executors
}

export const useExecutorRuntimeData = () => {
  const queryClient = useQueryClient()
  const executorsQueryKey = useMemo(() => workspaceQueryKeys.executors(), [])
  const executorsQuery = useQuery<ExecutorRecord[]>({
    queryKey: executorsQueryKey,
    staleTime: EXECUTORS_CACHE_TTL_MS,
    // 所有消费方共享这一份缓存和轮询，避免 dashboard/execution/workspaces 页面各自发起
    // 独立的 listExecutors 轮询请求（同时挂载时请求量会翻 3-4 倍）。
    refetchInterval: EXECUTORS_CACHE_TTL_MS,
    placeholderData: (previousData) => previousData,
    queryFn: loadExecutors,
  })

  const refreshExecutors = useCallback(async (force = false) => {
    if (force) {
      await queryClient.invalidateQueries({ queryKey: executorsQueryKey })
    }

    return queryClient.fetchQuery({
      queryKey: executorsQueryKey,
      queryFn: loadExecutors,
      staleTime: force ? 0 : EXECUTORS_CACHE_TTL_MS,
    }).catch(() => queryClient.getQueryData<ExecutorRecord[]>(executorsQueryKey) ?? [])
  }, [executorsQueryKey, queryClient])

  const setExecutorsData = useCallback((updater: (current: ExecutorRecord[]) => ExecutorRecord[]) => {
    queryClient.setQueryData<ExecutorRecord[]>(executorsQueryKey, (current) => updater(current ?? []))
  }, [executorsQueryKey, queryClient])

  return {
    executors: executorsQuery.data ?? [],
    executorsLoading: executorsQuery.isLoading,
    refreshExecutors,
    setExecutorsData,
  }
}
