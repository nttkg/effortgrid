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
  isReadOnly: boolean;
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
  wbsElementId,
  date,
  initialValue,
  onCommit,
  isReadOnly,
  onKeyDown,
  onPaste,
  onMouseDown,
  onMouseOver,
  isSelected,
}: {
  wbsElementId: number;
  date: string;
  initialValue?: number;
  onCommit: (value: number | null) => void;
  isReadOnly: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, date: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, date: string) => void;
  onMouseDown: (e: React.MouseEvent<HTMLInputElement>) => void;
  onMouseOver: () => void;
  isSelected: boolean;
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
      id={`cell-pv-${wbsElementId}-${date}`}
      classNames={{ input: classes.pv_input }}
      value={value}
      onChange={setValue}
      onBlur={handleBlur}
      onKeyDown={(e) => onKeyDown(e, wbsElementId, date)}
      onPaste={(e) => onPaste(e, wbsElementId, date)}
      onMouseDown={onMouseDown}
      onMouseOver={onMouseOver}
      style={{ backgroundColor: isSelected ? 'var(--mantine-color-blue-light)' : undefined, cursor: 'cell' }}
      step={0.1}
      min={0}
      hideControls
      readOnly={isReadOnly}
      variant="unstyled"
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
  isReadOnly,
  onCellKeyDown,
  onCellPaste,
  onCellMouseDown,
  onCellMouseOver,
  selectedCells,
}: {
  node: TreeNode;
  level: number;
  days: dayjs.Dayjs[];
  allocations: AllocationMap;
  allElements: WbsElementDetail[];
  onPvChange: (wbsElementId: number, date: string, value: number | null, shouldRefetch?: boolean) => void;
  isReadOnly: boolean;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, date: string) => void;
  onCellPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, date: string) => void;
  onCellMouseDown: (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, date: string) => void;
  onCellMouseOver: (wbsElementId: number, date: string) => void;
  selectedCells: Set<string>;
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
          const cellId = `cell-pv-${node.wbsElementId}-${dateStr}`;
          return (
            <Table.Td key={dateStr}>
              {node.elementType === 'Activity' ? (
                <PvInputCell
                  wbsElementId={node.wbsElementId}
                  date={dateStr}
                  initialValue={allocations[node.wbsElementId]?.[dateStr]?.pv}
                  onCommit={(value) => onPvChange(node.wbsElementId, dateStr, value)}
                  isReadOnly={isReadOnly}
                  onKeyDown={onCellKeyDown}
                  onPaste={onCellPaste}
                  onMouseDown={(e) => onCellMouseDown(e, node.wbsElementId, dateStr)}
                  onMouseOver={() => onCellMouseOver(node.wbsElementId, dateStr)}
                  isSelected={selectedCells.has(cellId)}
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
          isReadOnly={isReadOnly}
          onCellKeyDown={onCellKeyDown}
          onCellPaste={onCellPaste}
          onCellMouseDown={onCellMouseDown}
          onCellMouseOver={onCellMouseOver}
          selectedCells={selectedCells}
        />
      ))}
    </>
  );
};

// --- Main Component ---
export function AllocationGrid({ planVersionId, isReadOnly }: GridProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [elements, setElements] = useState<WbsElementDetail[]>([]);
  const [allocations, setAllocations] = useState<AllocationMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

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

  useEffect(() => {
    const handleMouseUp = () => setIsSelecting(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

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

  const { activityRowIds, dateStrs } = useMemo(() => {
    const activities: WbsElementDetail[] = [];
    const traverse = (nodes: TreeNode[]) => {
        for (const node of nodes) {
            if (node.elementType === 'Activity') {
                activities.push(node);
            }
            if (node.children) {
                traverse(node.children);
            }
        }
    };
    traverse(tree);
    const ids = activities.map(a => a.wbsElementId);
    const dates = daysInMonth.map(d => d.format('YYYY-MM-DD'));
    return { activityRowIds: ids, dateStrs: dates };
  }, [tree, daysInMonth]);

  const focusCell = (wbsElementId: number, date: string) => {
    const cell = document.getElementById(`cell-pv-${wbsElementId}-${date}`);
    cell?.focus();
  };

  const handleCellMouseDown = (e: React.MouseEvent, wbsElementId: number, date: string) => {
    e.preventDefault();
    setIsSelecting(true);
    const cellId = `cell-pv-${wbsElementId}-${date}`;
    
    if (e.shiftKey && selectionAnchor) {
        // Range selection
        const startIdParts = selectionAnchor.split('-');
        const startWbsId = Number(startIdParts[2]);
        const startDate = startIdParts.slice(3).join('-');

        const startRow = activityRowIds.indexOf(startWbsId);
        const startCol = dateStrs.indexOf(startDate);
        const endRow = activityRowIds.indexOf(wbsElementId);
        const endCol = dateStrs.indexOf(date);

        if (startRow === -1 || startCol === -1 || endRow === -1 || endCol === -1) {
            setSelectedCells(new Set([cellId]));
            return;
        }
        
        const newSelectedCells = new Set<string>();
        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);
        const minCol = Math.min(startCol, endCol);
        const maxCol = Math.max(startCol, endCol);

        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const cellWbsId = activityRowIds[r];
                const cellDate = dateStrs[c];
                newSelectedCells.add(`cell-pv-${cellWbsId}-${cellDate}`);
            }
        }
        setSelectedCells(newSelectedCells);
    } else {
        setSelectionAnchor(cellId);
        setSelectedCells(new Set([cellId]));
    }
  };

  const handleCellMouseOver = (wbsElementId: number, date: string) => {
    if (!isSelecting || !selectionAnchor) return;
    
    const startIdParts = selectionAnchor.split('-');
    const startWbsId = Number(startIdParts[2]);
    const startDate = startIdParts.slice(3).join('-');

    const startRow = activityRowIds.indexOf(startWbsId);
    const startCol = dateStrs.indexOf(startDate);
    const endRow = activityRowIds.indexOf(wbsElementId);
    const endCol = dateStrs.indexOf(date);

    if (startRow === -1 || startCol === -1 || endRow === -1 || endCol === -1) return;

    const newSelectedCells = new Set<string>();
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);

    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            const cellWbsId = activityRowIds[r];
            const cellDate = dateStrs[c];
            newSelectedCells.add(`cell-pv-${cellWbsId}-${cellDate}`);
        }
    }
    setSelectedCells(newSelectedCells);
  };

  const handlePvChange = useCallback(
    async (wbsElementId: number, date: string, value: number | null, shouldRefetch = true) => {
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
        if (shouldRefetch) {
          // Note: We refetch all data for simplicity. For better performance,
          // we could update the local `allocations` state optimistically.
          fetchAllData();
        }
      } catch (error) {
        console.error('Failed to upsert allocation:', error);
        // Optionally, show an error notification to the user
      }
    },
    [planVersionId, fetchAllData]
  );

  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, date: string) => {
      const { key } = e;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'].includes(key)) {
        return;
      }
      e.preventDefault();

      const rowIndex = activityRowIds.indexOf(wbsElementId);
      const colIndex = dateStrs.indexOf(date);

      if (key === 'ArrowUp' && rowIndex > 0) {
        focusCell(activityRowIds[rowIndex - 1], date);
      } else if (key === 'ArrowDown' && rowIndex < activityRowIds.length - 1) {
        focusCell(activityRowIds[rowIndex + 1], date);
      } else if (key === 'ArrowLeft' && colIndex > 0) {
        focusCell(wbsElementId, dateStrs[colIndex - 1]);
      } else if (key === 'ArrowRight' && colIndex < dateStrs.length - 1) {
        focusCell(wbsElementId, dateStrs[colIndex + 1]);
      } else if (key === 'Delete' || key === 'Backspace') {
        handlePvChange(wbsElementId, date, null);
      }
    },
    [activityRowIds, dateStrs, handlePvChange]
  );

  const handleCellPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLInputElement>, startWbsId: number, startDate: string) => {
        e.preventDefault();
        if (isReadOnly) return;

        const pasteData = e.clipboardData.getData('text');
        
        if (selectedCells.size > 1 && !pasteData.includes('\t') && !pasteData.includes('\n') && !pasteData.includes('\r')) {
            const valueStr = pasteData.trim();
            const value = !isNaN(parseFloat(valueStr)) ? parseFloat(valueStr) : null;
            const updates: Promise<void>[] = [];
            selectedCells.forEach(cellId => {
                const [,,, ...dateParts] = cellId.split('-');
                const cellWbsId = Number(cellId.split('-')[2]);
                updates.push(handlePvChange(cellWbsId, dateParts.join('-'), value, false));
            });
            await Promise.all(updates);
            fetchAllData();
            return;
        }

        const rows = pasteData.split(/\r\n|\n|\r/);

        const startRowIndex = activityRowIds.indexOf(startWbsId);
        const startColIndex = dateStrs.indexOf(startDate);

        if (startRowIndex === -1 || startColIndex === -1) return;

        const updates: Promise<void>[] = [];

        for (let i = 0; i < rows.length; i++) {
            const rowData = rows[i].split('\t');
            const currentRowIndex = startRowIndex + i;

            if (currentRowIndex >= activityRowIds.length) break;
            const currentWbsId = activityRowIds[currentRowIndex];

            for (let j = 0; j < rowData.length; j++) {
                const currentColIndex = startColIndex + j;
                if (currentColIndex >= dateStrs.length) break;

                const currentDate = dateStrs[currentColIndex];
                const valueStr = rowData[j].trim();
                const value = !isNaN(parseFloat(valueStr)) ? parseFloat(valueStr) : null;
                
                updates.push(handlePvChange(currentWbsId, currentDate, value, false));
            }
        }
        
        await Promise.all(updates);
        fetchAllData();
    },
    [activityRowIds, dateStrs, isReadOnly, handlePvChange, fetchAllData, selectedCells]
  );
  
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (selectedCells.size === 0 || !e.clipboardData) return;
      
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.id.startsWith('cell-pv-')) return;

      e.preventDefault();

      let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;
      
      const cellCoords = Array.from(selectedCells).map(cellId => {
        const [,,, ...dateParts] = cellId.split('-');
        const date = dateParts.join('-');
        const wbsId = Number(cellId.split('-')[2]);
        const r = activityRowIds.indexOf(wbsId);
        const c = dateStrs.indexOf(date);
        if (r > -1 && c > -1) {
            minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r);
            minCol = Math.min(minCol, c); maxCol = Math.max(maxCol, c);
        }
        return { r, c, wbsId, date };
      }).filter(item => item.r > -1 && item.c > -1);

      if (minRow === Infinity) return;

      const grid: (number | string)[][] = Array(maxRow - minRow + 1).fill(0).map(() => Array(maxCol - minCol + 1).fill(''));
      
      for (const { r, c, wbsId, date } of cellCoords) {
        const cellId = `cell-pv-${wbsId}-${date}`;
        if (selectedCells.has(cellId)) {
            const value = allocations[wbsId]?.[date]?.pv;
            grid[r - minRow][c - minCol] = value ?? '';
        }
      }
      
      const tsv = grid.map(row => row.join('\t')).join('\n');
      e.clipboardData.setData('text/plain', tsv);
    };

    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [selectedCells, allocations, activityRowIds, dateStrs]);

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
                onChange={(date) => date && setCurrentMonth(new Date(date))}
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
                      isReadOnly={isReadOnly}
                      onCellKeyDown={handleCellKeyDown}
                      onCellPaste={handleCellPaste}
                      onCellMouseDown={handleCellMouseDown}
                      onCellMouseOver={handleCellMouseOver}
                      selectedCells={selectedCells}
                  />
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}
    </Stack>
  );
}
