import { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Group,
  Title,
  Text,
  Table,
  NumberInput,
  Badge,
  ActionIcon,
  Box,
  Loader,
  Center,
  Alert,
  Stack,
} from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { IconChevronLeft, IconChevronRight, IconAlertCircle } from '@tabler/icons-react';
import { WbsElementDetail, WbsElementType, PvAllocation } from '../../types';
import dayjs from 'dayjs';
import classes from './AllocationGrid.module.css';

// --- Types ---
interface TreeNode extends WbsElementDetail {
  children: TreeNode[];
}

interface AllocationMap {
  [wbsElementId: number]: {
    [date: string]: { id: number; pv: number };
  };
}

interface GridProps {
  planVersionId: number | null;
}

// --- Helper Functions ---
const getBadgeColor = (type: WbsElementType) => {
  const colors: Record<WbsElementType, string> = {
    Project: 'blue',
    WorkPackage: 'cyan',
    Activity: 'teal',
  };
  return colors[type] || 'gray';
};

// --- Sub-components ---

// A stateful component to manage each editable cell, fixing issues with defaultValue.
const PvInputCell = ({
  initialValue,
  onCommit,
}: {
  initialValue?: number;
  onCommit: (value: number | null) => void;
}) => {
  const [value, setValue] = useState<string | number>(initialValue ?? '');

  useEffect(() => {
    setValue(initialValue ?? '');
  }, [initialValue]);

  const handleBlur = () => {
    const numericValue = value === '' ? null : Number(value);
    const initialNumericValue = initialValue ?? null;
    if (numericValue !== initialNumericValue) {
      onCommit(numericValue);
    }
  };

  return (
    <NumberInput
      classNames={{ input: classes.pv_input }}
      value={value}
      onChange={setValue}
      onBlur={handleBlur}
      step={0.1}
      min={0}
      hideControls
    />
  );
};

const GridRow = ({
  node,
  level,
  days,
  allocations,
  allElements,
  onPvChange,
}: {
  node: TreeNode;
  level: number;
  days: dayjs.Dayjs[];
  allocations: AllocationMap;
  allElements: WbsElementDetail[];
  onPvChange: (wbsElementId: number, date: string, value: number | null) => void;
}) => {
  // Memoize descendant IDs to avoid recalculating on every render
  const descendantIds = useMemo(() => {
    const getIds = (n: TreeNode): number[] => [
      n.wbsElementId,
      ...n.children.flatMap(getIds),
    ];
    return getIds(node);
  }, [node]);

  const activityDescendants = useMemo(() => {
    return allElements.filter(el => descendantIds.includes(el.wbsElementId) && el.elementType === 'Activity');
  }, [allElements, descendantIds]);

  const getRollupValue = (date: string): number => {
    return activityDescendants.reduce((sum, activity) => {
      return sum + (allocations[activity.wbsElementId]?.[date]?.pv || 0);
    }, 0);
  };

  const totalForMonth = useMemo(() => {
    const idsToSum = node.elementType === 'Activity' ? [node.wbsElementId] : activityDescendants.map(a => a.wbsElementId);
    return days.reduce((total, day) => {
        const dateStr = day.format('YYYY-MM-DD');
        return total + idsToSum.reduce((dayTotal, id) => dayTotal + (allocations[id]?.[dateStr]?.pv || 0), 0)
    }, 0)
  }, [days, allocations, node, activityDescendants]);

  return (
    <>
      <Table.Tr>
        <Table.Td className={classes.sticky_col}>
          <Group gap="xs" style={{ paddingLeft: level * 20 }}>
            <Badge color={getBadgeColor(node.elementType)} size="sm">
              {node.elementType.substring(0, 1)}
            </Badge>
            <Text size="sm" truncate>{node.title}</Text>
          </Group>
        </Table.Td>

        {days.map((day) => {
          const dateStr = day.format('YYYY-MM-DD');
          return (
            <Table.Td key={dateStr}>
              {node.elementType === 'Activity' ? (
                <PvInputCell
                  initialValue={allocations[node.wbsElementId]?.[dateStr]?.pv}
                  onCommit={(value) => onPvChange(node.wbsElementId, dateStr, value)}
                />
              ) : (
                <div className={classes.rollup_cell}>
                  {getRollupValue(dateStr) > 0 ? getRollupValue(dateStr).toFixed(1) : '-'}
                </div>
              )}
            </Table.Td>
          );
        })}
        <Table.Td className={classes.summary_col}>{node.estimatedPv || '-'}</Table.Td>
        <Table.Td className={classes.summary_col}>{totalForMonth > 0 ? totalForMonth.toFixed(1) : '-'}</Table.Td>
      </Table.Tr>
      {node.children.map((child) => (
        <GridRow
          key={child.id}
          node={child}
          level={level + 1}
          days={days}
          allocations={allocations}
          allElements={allElements}
          onPvChange={onPvChange}
        />
      ))}
    </>
  );
};

// --- Main Component ---
export function AllocationGrid({ planVersionId }: GridProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [elements, setElements] = useState<WbsElementDetail[]>([]);
  const [allocations, setAllocations] = useState<AllocationMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const daysInMonth = useMemo(() => {
    const start = dayjs(currentMonth).startOf('month');
    const end = dayjs(currentMonth).endOf('month');
    const days: dayjs.Dayjs[] = [];
    let current = start;
    while (current.isBefore(end) || current.isSame(end, 'day')) {
      days.push(current);
      current = current.add(1, 'day');
    }
    return days;
  }, [currentMonth]);

  const fetchAllData = useCallback(async () => {
    if (!planVersionId) {
      setElements([]);
      setAllocations({});
      return;
    }
    setIsLoading(true);
    setError(null);
    const start = daysInMonth[0].format('YYYY-MM-DD');
    const end = daysInMonth[daysInMonth.length - 1].format('YYYY-MM-DD');

    try {
      const [wbs, allocs] = await Promise.all([
        invoke<WbsElementDetail[]>('list_wbs_elements', { planVersionId }),
        invoke<PvAllocation[]>('list_allocations_for_period', {
          payload: { planVersionId, startDate: start, endDate: end },
        }),
      ]);

      setElements(wbs);

      const allocMap: AllocationMap = {};
      for (const alloc of allocs) {
        if (!allocMap[alloc.wbsElementId]) {
          allocMap[alloc.wbsElementId] = {};
        }
        allocMap[alloc.wbsElementId][alloc.startDate] = { id: alloc.id, pv: alloc.plannedValue };
      }
      setAllocations(allocMap);
    } catch (err: any) {
      console.error('Failed to fetch data:', err);
      setError(`Failed to load allocation data. Check console for details.`);
    } finally {
      setIsLoading(false);
    }
  }, [planVersionId, daysInMonth]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const tree = useMemo(() => {
    const items = [...elements];
    const map: { [key: number]: TreeNode } = {};
    const roots: TreeNode[] = [];
    items.forEach((item) => {
      map[item.wbsElementId] = { ...item, children: [] };
    });
    items.forEach((item) => {
      const node = map[item.wbsElementId];
      if (item.parentElementId && map[item.parentElementId]) {
        map[item.parentElementId].children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }, [elements]);

  const handlePvChange = useCallback(
    async (wbsElementId: number, date: string, value: number | null) => {
      if (!planVersionId) return;
      try {
        await invoke('upsert_daily_allocation', {
          payload: {
            planVersionId,
            wbsElementId,
            date,
            plannedValue: value,
          },
        });
        // Note: We refetch all data for simplicity. For better performance,
        // we could update the local `allocations` state optimistically.
        fetchAllData();
      } catch (error) {
        console.error('Failed to upsert allocation:', error);
        // Optionally, show an error notification to the user
      }
    },
    [planVersionId, fetchAllData]
  );
  
  const changeMonth = (amount: number) => {
    setCurrentMonth(dayjs(currentMonth).add(amount, 'month').toDate());
  };

  if (!planVersionId) {
    return <Text c="dimmed" ta="center" pt="xl">Please select a project to see its allocation grid.</Text>;
  }

  return (
    <Stack h="100%">
      <Group justify="space-between">
        <Title order={2}>Resource Allocation</Title>
        <Group>
            <ActionIcon onClick={() => changeMonth(-1)} variant="default" aria-label="Previous month"><IconChevronLeft size={16} /></ActionIcon>
            <MonthPickerInput
                value={currentMonth}
                onChange={(date) => date && setCurrentMonth(date)}
                placeholder="Pick month"
                style={{width: 150}}
            />
            <ActionIcon onClick={() => changeMonth(1)} variant="default" aria-label="Next month"><IconChevronRight size={16} /></ActionIcon>
        </Group>
      </Group>

      {isLoading && <Center style={{flex: 1}}><Loader /></Center>}
      {error && <Alert title="Error" color="red" icon={<IconAlertCircle />}>{error}</Alert>}

      {!isLoading && !error && (
        <Box className={classes.table_container}>
          <Table className={classes.table} withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className={classes.sticky_col_header}>WBS Element</Table.Th>
                {daysInMonth.map((day) => {
                  const isWeekend = day.day() === 0 || day.day() === 6;
                  return (
                    <Table.Th key={day.format('YYYY-MM-DD')} className={`${classes.day_header} ${isWeekend ? classes.day_header_weekend : ''}`}>
                      <div>{day.format('ddd')}</div>
                      <div>{day.format('D')}</div>
                    </Table.Th>
                  );
                })}
                <Table.Th>Est. PV</Table.Th>
                <Table.Th>Month Total</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tree.map(node => (
                  <GridRow 
                      key={node.id}
                      node={node}
                      level={0}
                      days={daysInMonth}
                      allocations={allocations}
                      allElements={elements}
                      onPvChange={handlePvChange}
                  />
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}
    </Stack>
  );
}

// --- Types ---
interface TreeNode extends WbsElementDetail {
  children: TreeNode[];
}

interface AllocationMap {
  [wbsElementId: number]: {
    [date: string]: { id: number; pv: number };
  };
}

interface GridProps {
  planVersionId: number | null;
}

// --- Helper Functions ---
const formatDate = (date: Date): string => dayjs(date).format('YYYY-MM-DD');

const getBadgeColor = (type: WbsElementType) => {
  const colors: Record<WbsElementType, string> = {
    Project: 'blue',
    WorkPackage: 'cyan',
    Activity: 'teal',
  };
  return colors[type] || 'gray';
};


// --- Sub-components ---

// A stateful component to manage each editable cell, fixing the defaultValue issue.
const PvInputCell = ({
  initialValue,
  onCommit,
}: {
  initialValue?: number;
  onCommit: (value: number | null) => void;
}) => {
  const [value, setValue] = useState<string | number>(initialValue ?? '');

  useEffect(() => {
    setValue(initialValue ?? '');
  }, [initialValue]);

  const handleBlur = () => {
    const numericValue = value === '' ? null : Number(value);
    const initialNumericValue = initialValue ?? null;
    if (numericValue !== initialNumericValue) {
      onCommit(numericValue);
    }
  };

  return (
    <NumberInput
      classNames={{ input: classes.pv_input }}
      value={value}
      onChange={setValue}
      onBlur={handleBlur}
      step={0.1}
      min={0}
      hideControls
    />
  );
};

const GridRow = ({
  node,
  level,
  days,
  allocations,
  allElements,
  onPvChange,
}: {
  node: TreeNode;
  level: number;
  days: dayjs.Dayjs[];
  allocations: AllocationMap;
  allElements: WbsElementDetail[];
  onPvChange: (wbsElementId: number, date: string, value: number | null) => void;
}) => {
  // Memoize descendant IDs to avoid recalculating on every render
  const descendantIds = useMemo(() => {
    const getIds = (n: TreeNode): number[] => [
      n.wbsElementId,
      ...n.children.flatMap(getIds),
    ];
    return getIds(node);
  }, [node]);

  const activityDescendants = useMemo(() => {
      return allElements.filter(el => descendantIds.includes(el.wbsElementId) && el.elementType === 'Activity')
  }, [allElements, descendantIds]);


  const getRollupValue = (date: string): number => {
    return activityDescendants.reduce((sum, activity) => {
      return sum + (allocations[activity.wbsElementId]?.[date]?.pv || 0);
    }, 0);
  };

  return (
    <>
      <Table.Tr>
        <Table.Td className={classes.sticky_col}>
          <Group gap="xs" style={{ paddingLeft: level * 20 }}>
            <Badge color={getBadgeColor(node.elementType)} size="sm">
              {node.elementType.substring(0, 1)}
            </Badge>
            <Text size="sm" truncate>{node.title}</Text>
          </Group>
        </Table.Td>

        {days.map((day) => {
          const dateStr = day.format('YYYY-MM-DD');
          return (
            <Table.Td key={dateStr}>
              {node.elementType === 'Activity' ? (
                <PvInputCell
                  initialValue={allocations[node.wbsElementId]?.[dateStr]?.pv}
                  onCommit={(value) => onPvChange(node.wbsElementId, dateStr, value)}
                />
              ) : (
                <div className={classes.rollup_cell}>
                  {getRollupValue(dateStr) > 0 ? getRollupValue(dateStr).toFixed(1) : '-'}
                </div>
              )}
            </Table.Td>
          );
        })}
      </Table.Tr>
      {node.children.map((child) => (
        <GridRow
          key={child.id}
          node={child}
          level={level + 1}
          days={days}
          allocations={allocations}
          allElements={allElements}
          onPvChange={onPvChange}
        />
      ))}
    </>
  );
};


// --- Main Component ---
export function AllocationGrid({ planVersionId }: GridProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [elements, setElements] = useState<WbsElementDetail[]>([]);
  const [allocations, setAllocations] = useState<AllocationMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const daysInMonth = useMemo(() => {
    const start = dayjs(currentMonth).startOf('month');
    const end = dayjs(currentMonth).endOf('month');
    const days: dayjs.Dayjs[] = [];
    let current = start;
    while (current.isBefore(end) || current.isSame(end, 'day')) {
      days.push(current);
      current = current.add(1, 'day');
    }
    return days;
  }, [currentMonth]);

  const fetchAllData = useCallback(async () => {
    if (!planVersionId) {
      setElements([]);
      setAllocations({});
      return;
    }
    setIsLoading(true);
    setError(null);
    const start = daysInMonth[0].format('YYYY-MM-DD');
    const end = daysInMonth[daysInMonth.length - 1].format('YYYY-MM-DD');

    try {
      const [wbs, allocs] = await Promise.all([
        invoke<WbsElementDetail[]>('list_wbs_elements', { planVersionId }),
        invoke<PvAllocation[]>('list_allocations_for_period', {
          payload: { planVersionId, startDate: start, endDate: end },
        }),
      ]);

      setElements(wbs);

      const allocMap: AllocationMap = {};
      for (const alloc of allocs) {
        if (!allocMap[alloc.wbsElementId]) {
          allocMap[alloc.wbsElementId] = {};
        }
        allocMap[alloc.wbsElementId][alloc.startDate] = { id: alloc.id, pv: alloc.plannedValue };
      }
      setAllocations(allocMap);
    } catch (err: any) {
      console.error('Failed to fetch data:', err);
      setError(`Failed to load allocation data. Check console for details.`);
    } finally {
      setIsLoading(false);
    }
  }, [planVersionId, daysInMonth]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const tree = useMemo(() => {
    const items = [...elements];
    const map: { [key: number]: TreeNode } = {};
    const roots: TreeNode[] = [];
    items.forEach((item) => {
      map[item.wbsElementId] = { ...item, children: [] };
    });
    items.forEach((item) => {
      const node = map[item.wbsElementId];
      if (item.parentElementId && map[item.parentElementId]) {
        map[item.parentElementId].children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }, [elements]);

  const handlePvChange = useCallback(
    async (wbsElementId: number, date: string, value: number | null) => {
      if (!planVersionId) return;
      try {
        await invoke('upsert_daily_allocation', {
          payload: {
            planVersionId,
            wbsElementId,
            date,
            plannedValue: value,
          },
        });
        // Note: We refetch all data for simplicity. For better performance,
        // we could update the local `allocations` state optimistically.
        fetchAllData();
      } catch (error) {
        console.error('Failed to upsert allocation:', error);
        // Optionally, show an error notification to the user
      }
    },
    [planVersionId, fetchAllData]
  );
  
  const changeMonth = (amount: number) => {
    setCurrentMonth(dayjs(currentMonth).add(amount, 'month').toDate());
  };

  if (!planVersionId) {
    return <Text c="dimmed" ta="center" pt="xl">Please select a project to see its allocation grid.</Text>;
  }

  return (
    <Stack h="100%">
      <Group justify="space-between">
        <Title order={2}>Resource Allocation</Title>
        <Group>
            <ActionIcon onClick={() => changeMonth(-1)} variant="default" aria-label="Previous month"><IconChevronLeft size={16} /></ActionIcon>
            <MonthPickerInput
                value={currentMonth}
                onChange={(date) => date && setCurrentMonth(date)}
                placeholder="Pick month"
                style={{width: 150}}
            />
            <ActionIcon onClick={() => changeMonth(1)} variant="default" aria-label="Next month"><IconChevronRight size={16} /></ActionIcon>
        </Group>
      </Group>

      {isLoading && <Center style={{flex: 1}}><Loader /></Center>}
      {error && <Alert title="Error" color="red" icon={<IconAlertCircle />}>{error}</Alert>}

      {!isLoading && !error && (
        <Box className={classes.table_container}>
          <Table className={classes.table} withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className={classes.sticky_col_header}>WBS Element</Table.Th>
                {daysInMonth.map((day) => {
                  const isWeekend = day.day() === 0 || day.day() === 6;
                  return (
                    <Table.Th key={day.format('YYYY-MM-DD')} className={`${classes.day_header} ${isWeekend ? classes.day_header_weekend : ''}`}>
                      <div>{day.format('ddd')}</div>
                      <div>{day.format('D')}</div>
                    </Table.Th>
                  );
                })}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tree.map(node => (
                  <GridRow 
                      key={node.id}
                      node={node}
                      level={0}
                      days={daysInMonth}
                      allocations={allocations}
                      allElements={elements}
                      onPvChange={handlePvChange}
                  />
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}
    </Stack>
  );
}
