import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Group, Title, Text, Table, NumberInput, Badge, Box, Loader, Center, Alert, Stack, ActionIcon, Menu, Avatar, Tooltip, rem, SegmentedControl, Button, ScrollArea, Modal,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { MonthPickerInput, DatePickerInput } from '@mantine/dates';
import { IconChevronLeft, IconChevronRight, IconAlertCircle, IconPlus, IconZoomOut, IconZoomIn, IconClipboardCopy, IconTarget, IconChevronDown, IconChevronsDown, IconChevronsRight, IconRefresh } from '@tabler/icons-react';
import { WbsElementDetail, WbsElementType, PvAllocation, ActualCost, ExecutionData, User } from '../../types';
import { useUsers } from '../../hooks/useUsers';
import { ImportWizardModal } from '../../components/ImportWizardModal';
import dayjs from 'dayjs';
import classes from './ExecutionView.module.css';
import isoWeek from 'dayjs/plugin/isoWeek';
dayjs.extend(isoWeek);


// --- Types ---
type ViewMode = 'daily' | 'weekly';

interface DayColumn {
  key: string;
  type: 'day';
  date: dayjs.Dayjs;
}
interface WeekColumn {
  key: string;
  type: 'week';
  label: string;
  dates: dayjs.Dayjs[];
}
type Column = DayColumn | WeekColumn;

interface TreeNode extends WbsElementDetail {
  children: TreeNode[];
}
interface ExecutionMap {
  [wbsElementId: number]: {
    [userId: number]: { // 0 for unassigned PV
      [date: string]: { pv?: number; ac?: { id: number; value: number } };
    };
  };
}
interface GridProps {
  planVersionId: number | null;
  isReadOnly: boolean;
}
// --- Helper Functions ---
function useEvent<T extends (...args: any[]) => any>(handler: T) {
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; });
  return useCallback((...args: Parameters<T>) => {
    const fn = handlerRef.current;
    return fn(...args);
  }, []);
}
const getBadgeColor = (type: WbsElementType) => ({ Project: 'blue', WorkPackage: 'cyan', Activity: 'teal' }[type] || 'gray');

// --- Sub-components ---
const ProgressInputCell = React.memo(({ wbsElementId, date, initialValue, onCommit, isReadOnly }: {
  wbsElementId: number; date: string; initialValue?: number; isReadOnly: boolean;
  onCommit: (wbsId: number, d: string, val: number | null) => void;
}) => {
  const [value, setValue] = useState<string | number>(initialValue ?? '');
  useEffect(() => { setValue(initialValue ?? ''); }, [initialValue]);

  const handleBlur = () => {
    const numericValue = value === '' ? null : Number(value);
    const initialNumericValue = initialValue ?? null;
    if (numericValue !== initialNumericValue) onCommit(wbsElementId, date, numericValue);
  };
  
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <input
        type="number"
        className={`${classes.ac_input_native} ${classes.progress_input}`}
        style={{ 
          cursor: 'cell', 
          color: value !== '' ? 'var(--mantine-color-teal-4)' : undefined 
        }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        step="0.1" min="0" max="100"
        readOnly={isReadOnly}
      />
      {value !== '' && (
        <span className={classes.progress_symbol}>%</span>
      )}
    </div>
  );
});
const PvInputCell = React.memo(({ wbsElementId, userId, date, initialPv, onCommit, isReadOnly, onKeyDown, onPaste, onMouseDown, onMouseOver }: {
  wbsElementId: number; userId: number; date: string; initialPv?: number; isReadOnly: boolean;
  onCommit: (wbsId: number, uId: number, d: string, val: number | null) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => void;
  onMouseDown: (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => void;
  onMouseOver: (wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => void;
}) => {
  const [value, setValue] = useState<string | number>(initialPv ?? '');
  useEffect(() => { setValue(initialPv ?? ''); }, [initialPv]);

  const handleBlur = () => {
    const numericValue = value === '' ? null : Number(value);
    const initialNumericValue = initialPv ?? null;
    if (numericValue !== initialNumericValue) onCommit(wbsElementId, userId, date, numericValue);
  };

  return (
    <input
      id={`cell-pv-${wbsElementId}-${userId}-${date}`}
      type="number"
      className={classes.ac_input_native}
      style={{
        cursor: 'cell',
        color: 'var(--mantine-color-blue-3)'
      }}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => onKeyDown(e as any, wbsElementId, userId, date, 'pv')}
      onPaste={(e) => onPaste(e as any, wbsElementId, userId, date, 'pv')}
      onMouseDown={(e) => onMouseDown(e as any, wbsElementId, userId, date, 'pv')}
      onMouseOver={() => onMouseOver(wbsElementId, userId, date, 'pv')}
      step="0.1" min="0"
      readOnly={isReadOnly}
    />
  );
});

const AcInputCell = React.memo(({ wbsElementId, userId, date, initialAc, onCommit, isReadOnly, onKeyDown, onPaste, onMouseDown, onMouseOver }: {
  wbsElementId: number; userId: number; date: string; initialAc?: number; isReadOnly: boolean;
  onCommit: (wbsId: number, uId: number, d: string, val: number | null) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => void;
  onMouseDown: (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => void;
  onMouseOver: (wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => void;
}) => {
  const [value, setValue] = useState<string | number>(initialAc ?? '');
  useEffect(() => { setValue(initialAc ?? ''); }, [initialAc]);

  const handleBlur = () => {
    const numericValue = value === '' ? null : Number(value);
    const initialNumericValue = initialAc ?? null;
    if (numericValue !== initialNumericValue) onCommit(wbsElementId, userId, date, numericValue);
  };

  return (
    <input
      id={`cell-ac-${wbsElementId}-${userId}-${date}`}
      type="number"
      className={classes.ac_input_native}
      style={{
        cursor: 'cell'
      }}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => onKeyDown(e as any, wbsElementId, userId, date, 'ac')}
      onPaste={(e) => onPaste(e as any, wbsElementId, userId, date, 'ac')}
      onMouseDown={(e) => onMouseDown(e as any, wbsElementId, userId, date, 'ac')}
      onMouseOver={() => onMouseOver(wbsElementId, userId, date, 'ac')}
      step="0.1" min="0"
      readOnly={isReadOnly}
    />
  );
});

const ResourceCapacityFooter = React.memo(({ users, elements, data, columns }: {
    users: User[];
    elements: WbsElementDetail[];
    data: ExecutionMap;
    columns: Column[];
}) => {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

    const dailyTotals = useMemo(() => {
        const totals: { [userId: number]: { [date: string]: { pv: number, ac: number } } } = {};
        const activityIds = new Set(elements.filter(e => e.elementType === 'Activity').map(e => e.wbsElementId));

        for (const wbsIdStr in data) {
            const wbsId = Number(wbsIdStr);
            if (!activityIds.has(wbsId)) continue;

            const userEntries = data[wbsId];
            for (const userIdStr in userEntries) {
                const userId = Number(userIdStr);
                if (userId === 0) continue; 

                if (!totals[userId]) totals[userId] = {};
                
                const dateEntries = userEntries[userId];
                for (const date in dateEntries) {
                    if (!totals[userId][date]) totals[userId][date] = { pv: 0, ac: 0 };
                    totals[userId][date].pv += dateEntries[date].pv || 0;
                    totals[userId][date].ac += dateEntries[date].ac?.value || 0;
                }
            }
        }
        return totals;
    }, [data, elements]);

    const activeUserIds = useMemo(() => Object.keys(dailyTotals).map(Number).sort((a, b) => a - b), [dailyTotals]);

    if (activeUserIds.length === 0) return null;
    
    return (
        <Table.Tfoot>
            <Table.Tr>
                <Table.Th className={classes.wbs_col}>
                  <Group gap="xs" wrap="nowrap">
                    <ActionIcon variant="subtle" size="sm" color="gray" onClick={() => setIsCollapsed(!isCollapsed)}>
                      {isCollapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
                    </ActionIcon>
                    <Text size="sm" fw={700}>Resource Capacity</Text>
                  </Group>
                </Table.Th>
                <Table.Th className={classes.metric_col}></Table.Th>
                <Table.Th className={classes.total_col}></Table.Th>
                <Table.Th colSpan={columns.length}></Table.Th>
            </Table.Tr>
            {!isCollapsed && activeUserIds.map(userId => {
                const user = userMap.get(userId);
                if (!user) return null;

                const totalPv = Object.values(dailyTotals[userId] || {}).reduce((sum, d) => sum + d.pv, 0);
                const totalAc = Object.values(dailyTotals[userId] || {}).reduce((sum, d) => sum + d.ac, 0);

                return (
                    <React.Fragment key={userId}>
                        <Table.Tr>
                            <Table.Td rowSpan={2} className={classes.wbs_col} style={{ verticalAlign: 'middle', borderBottom: '2px solid var(--mantine-color-dark-3)' }}>
                                <Group gap="xs">
                                    <Avatar size="sm">{user.name.substring(0, 2)}</Avatar>
                                    <Text size="xs">{user.name}</Text>
                                </Group>
                            </Table.Td>
                            <Table.Td className={`${classes.metric_col} ${classes.readonly_cell}`} style={{ borderBottom: 'none' }}>PV</Table.Td>
                            <Table.Td className={`${classes.total_col} ${classes.readonly_cell}`} style={{ borderBottom: 'none' }}>
                                <Text size="sm" c="blue.3">{totalPv > 0 ? totalPv.toFixed(1) : ''}</Text>
                            </Table.Td>
                            {columns.map(col => {
                                const total = col.type === 'day'
                                    ? dailyTotals[userId]?.[col.key]?.pv || 0
                                    : col.dates.reduce((sum, day) => sum + (dailyTotals[userId]?.[day.format('YYYY-MM-DD')]?.pv || 0), 0);
                                return (
                                    <Table.Td key={`${col.key}-pv`} className={`${classes.data_cell} ${classes.readonly_cell}`} style={{ textAlign: 'right', borderBottom: 'none' }}>
                                        <Text size="sm" c="blue.3">{total > 0 ? total.toFixed(1) : ''}</Text>
                                    </Table.Td>
                                );
                            })}
                        </Table.Tr>
                        <Table.Tr>
                            <Table.Td className={classes.metric_col} style={{ borderTop: 'none', borderBottom: '2px solid var(--mantine-color-dark-3)' }}>AC</Table.Td>
                            <Table.Td className={classes.total_col} style={{ borderTop: 'none', borderBottom: '2px solid var(--mantine-color-dark-3)' }}>
                                <Text size="sm" fw="500">{totalAc > 0 ? totalAc.toFixed(1) : ''}</Text>
                            </Table.Td>
                            {columns.map(col => {
                                const totalAcForPeriod = col.type === 'day'
                                    ? dailyTotals[userId]?.[col.key]?.ac || 0
                                    : col.dates.reduce((sum, day) => sum + (dailyTotals[userId]?.[day.format('YYYY-MM-DD')]?.ac || 0), 0);
                                
                                const capacity = user.dailyCapacity ?? 8.0;
                                const isOverloaded = col.type === 'day' 
                                    ? totalAcForPeriod > capacity
                                    : col.dates.some(d => (dailyTotals[userId]?.[d.format('YYYY-MM-DD')]?.ac || 0) > capacity);

                                return (
                                    <Table.Td key={`${col.key}-ac`} style={{textAlign: 'right', color: isOverloaded ? 'var(--mantine-color-red-7)' : undefined, borderTop: 'none', borderBottom: '2px solid var(--mantine-color-dark-3)' }}>
                                        {totalAcForPeriod > 0 ? totalAcForPeriod.toFixed(1) : ''}
                                    </Table.Td>
                                );
                            })}
                        </Table.Tr>
                    </React.Fragment>
                );
            })}
        </Table.Tfoot>
    );
});

const gridRowAreEqual = (prevProps: any, nextProps: any) => {
  if (prevProps.data !== nextProps.data) return false;
  if (prevProps.progressData !== nextProps.progressData) return false;
  if (prevProps.columns !== nextProps.columns) return false;
  if (prevProps.assignedUsersMap !== nextProps.assignedUsersMap) return false;
  if (prevProps.allPlanAllocations !== nextProps.allPlanAllocations) return false;
  if (prevProps.allPlanActuals !== nextProps.allPlanActuals) return false;
  if (prevProps.isReadOnly !== nextProps.isReadOnly) return false;
  if (prevProps.isCollapsed !== nextProps.isCollapsed) return false;
  if (prevProps.onToggleCollapse !== nextProps.onToggleCollapse) return false;

  return true;
};

const GridRow = React.memo(({ 
    node, level, columns, data, progressData, allElements, allPlanAllocations, allPlanActuals, users, assignedUsersMap,
    onPvChange, onAcChange, onProgressChange, isReadOnly, onAddUser,
    onCellKeyDown, onCellPaste, onCellMouseDown, onCellMouseOver,
    isCollapsed, onToggleCollapse
}: {
  node: TreeNode; level: number; columns: Column[]; data: ExecutionMap; progressData: { [wbsId: number]: { [date: string]: { id: number; value: number } } }; allElements: WbsElementDetail[]; allPlanAllocations: PvAllocation[]; allPlanActuals: ActualCost[]; users: User[];
  assignedUsersMap: { [wbsId: number]: Set<number> };
  onPvChange: (wbsElementId: number, userId: number, date: string, value: number | null) => void;
  onAcChange: (wbsElementId: number, userId: number, date: string, value: number | null) => void;
  onProgressChange: (wbsElementId: number, date: string, value: number | null) => void;
  isReadOnly: boolean;
  onAddUser: (wbsElementId: number, userId: number) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => void;
  onCellPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => void;
  onCellMouseDown: (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => void;
  onCellMouseOver: (wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => void;
  isCollapsed: boolean;
  onToggleCollapse: (nodeId: number) => void;
}) => {
  const isActivity = node.elementType === 'Activity';
  const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);
  const assignedUsers = useMemo(() => assignedUsersMap[node.wbsElementId] || new Set(), [assignedUsersMap, node.wbsElementId]);

  const latestProgress = useMemo(() => {
    const activityProgress = progressData[node.wbsElementId];
    if (!activityProgress) return null;
    const dates = Object.keys(activityProgress);
    if (dates.length === 0) return null;
    const latestDate = dates.reduce((a, b) => a > b ? a : b);
    return activityProgress[latestDate]?.value;
  }, [progressData, node.wbsElementId]);

  const hasUnassignedPv = useMemo(() => {
    const unassignedData = data[node.wbsElementId]?.[0];
    if (!unassignedData) return false;
    return Object.values(unassignedData).some(d => d.pv && d.pv > 0);
  }, [data, node.wbsElementId]);

  const activityDescendants = useMemo(() => {
    const descendantIds = new Set<number>();
    const traverse = (n: TreeNode) => {
        descendantIds.add(n.wbsElementId);
        if (n.children) {
            n.children.forEach(traverse);
        }
    };
    traverse(node);
    return allElements.filter(el => descendantIds.has(el.wbsElementId) && el.elementType === 'Activity');
  }, [node, allElements]);

  const getRollupValue = (column: Column, type: 'pv' | 'ac'): number => {
    return activityDescendants.reduce((sum, activity) => {
      const activityData = data[activity.wbsElementId];
      if (!activityData) return sum;
      return sum + Object.values(activityData).reduce((userSum, userEntries) => {
        if (column.type === 'day') {
            const cellData = userEntries[column.key];
            if (!cellData) return userSum;
            if (type === 'pv') return userSum + (cellData.pv || 0);
            if (type === 'ac') return userSum + (cellData.ac?.value || 0);
            return userSum;
        } else {
            return userSum + column.dates.reduce((dateSum, date) => {
                const cellData = userEntries[date.format('YYYY-MM-DD')];
                if (!cellData) return dateSum;
                if (type === 'pv') return dateSum + (cellData.pv || 0);
                if (type === 'ac') return dateSum + (cellData.ac?.value || 0);
                return dateSum;
            }, 0);
        }
      }, 0);
    }, 0);
  };

  const { nodeTotalAllocated, nodeTotalActuals } = useMemo(() => {
    const activityIds = activityDescendants.map(a => a.wbsElementId);
    const totalAllocated = allPlanAllocations
        .filter(alloc => activityIds.includes(alloc.wbsElementId))
        .reduce((sum, alloc) => sum + alloc.plannedValue, 0);

    const totalActuals = allPlanActuals
        .filter(ac => activityIds.includes(ac.wbsElementId))
        .reduce((sum, ac) => sum + ac.actualCost, 0);
        
    return { nodeTotalAllocated: totalAllocated, nodeTotalActuals: totalActuals };
  }, [activityDescendants, allPlanAllocations, allPlanActuals]);

  const getRollupProgress = (dateStr?: string): number | null => {
    let totalBac = 0;
    let totalEv = 0;
    let hasAnyProgress = false;
    
    activityDescendants.forEach(activity => {
      const bac = activity.estimatedPv || 0;
      totalBac += bac;
      if (bac > 0) {
        const activityProgress = progressData[activity.wbsElementId];
        if (activityProgress) {
          const dates = Object.keys(activityProgress);
          let latestDate: string | null = null;
          for (const d of dates) {
            if ((!dateStr || d <= dateStr) && (!latestDate || d > latestDate)) {
              latestDate = d;
            }
          }
          if (latestDate) {
            const percent = activityProgress[latestDate].value;
            totalEv += bac * (percent / 100.0);
            hasAnyProgress = true;
          }
        }
      }
    });
    
    return (totalBac > 0 && hasAnyProgress) ? (totalEv / totalBac) * 100 : null;
  };

  const userTotalAllocated = (userId: number) => {
      return allPlanAllocations
          .filter(alloc => alloc.wbsElementId === node.wbsElementId && alloc.userId === userId)
          .reduce((sum, alloc) => sum + alloc.plannedValue, 0);
  };

  const userTotalActuals = (userId: number) => {
    return allPlanActuals
        .filter(ac => ac.wbsElementId === node.wbsElementId && ac.userId === userId)
        .reduce((sum, ac) => sum + ac.actualCost, 0);
  };

  const usersToRender = useMemo(() => {
    const userIds = Array.from(assignedUsers);
    if (hasUnassignedPv && !userIds.includes(0)) {
        userIds.push(0);
    }
    return userIds.sort((a, b) => {
        if (a === 0) return -1; // Unassigned always first
        if (b === 0) return 1;
        return a - b;
    });
  }, [assignedUsers, hasUnassignedPv]);
  const availableUsers = useMemo(() => users.filter(u => !assignedUsers.has(u.id)), [users, assignedUsers]);

  const isLastRowOfItem = !isActivity || usersToRender.length === 0;
  const itemBorderBottom = '2px solid var(--mantine-color-dark-3)';
  const normalBorderBottom = '1px solid var(--mantine-color-dark-4)';
  const progressBorderBottom = isLastRowOfItem ? itemBorderBottom : normalBorderBottom;

  return (
    <>
      {/* --- 1st Row: PV --- */}
      <Table.Tr>
        <Table.Td rowSpan={3} className={classes.wbs_col} style={{ verticalAlign: 'top', borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
          <Group gap="xs" style={{ paddingLeft: level * 20, paddingTop: 6 }} wrap="nowrap" align="center">
            {node.children.length > 0 ? (
                <ActionIcon variant="subtle" size="sm" onClick={() => onToggleCollapse(node.wbsElementId)}>
                    {isCollapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
                </ActionIcon>
            ) : (
                <Box w={26} />
            )}
            {isActivity && (
              <Menu shadow="md" width={200}>
                <Menu.Target><Tooltip label="Add person"><ActionIcon variant="subtle" size="sm"><IconPlus size={14} /></ActionIcon></Tooltip></Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Assign a person</Menu.Label>
                  {availableUsers.map(user => (
                    <Menu.Item key={user.id} leftSection={<Avatar size="sm">{user.name.substring(0, 2)}</Avatar>} onClick={() => onAddUser(node.wbsElementId, user.id)}>
                      {user.name}
                    </Menu.Item>
                  ))}
                  {availableUsers.length === 0 && <Menu.Item disabled>No one else to assign</Menu.Item>}
                </Menu.Dropdown>
              </Menu>
            )}
            <Badge color={getBadgeColor(node.elementType)} size="sm">{node.elementType.substring(0, 1)}</Badge>
            <Tooltip label={node.title} openDelay={500}>
              <Text size="sm" truncate style={{ flex: 1 }}>{node.title}</Text>
            </Tooltip>
          </Group>
        </Table.Td>
        <Table.Td className={`${classes.metric_col} ${classes.readonly_cell}`} style={{ borderBottom: 'none' }}>PV</Table.Td>
        <Table.Td className={`${classes.total_col} ${classes.readonly_cell}`} style={{ borderBottom: 'none' }}>
          <Group gap={2} justify="flex-end" wrap="nowrap">
            <Text size="sm" c="blue.3">{nodeTotalAllocated > 0 ? nodeTotalAllocated.toFixed(1) : '0.0'}</Text>
            {node.estimatedPv != null && (
              <Text size="xs" c="dimmed">/ {node.estimatedPv.toFixed(1)}</Text>
            )}
          </Group>
        </Table.Td>
        {columns.map((col) => {
          const val = getRollupValue(col, 'pv');
          return (
            <Table.Td key={`${col.key}-pv`} className={`${classes.data_cell} ${classes.readonly_cell}`} style={{ textAlign: 'right', borderBottom: 'none' }}>
              <Text size="sm" c="blue.3">{val > 0 ? val.toFixed(1) : ''}</Text>
            </Table.Td>
          );
        })}
      </Table.Tr>

      {/* --- 2nd Row: AC --- */}
      <Table.Tr>
        <Table.Td className={`${classes.metric_col} ${classes.readonly_cell}`} style={{ borderTop: 'none', borderBottom: 'none' }}>AC</Table.Td>
        <Table.Td className={`${classes.total_col} ${classes.readonly_cell}`} style={{ borderTop: 'none', borderBottom: 'none' }}>
          <Text size="sm" fw={500} style={{ color: nodeTotalActuals > nodeTotalAllocated ? 'var(--mantine-color-red-7)' : undefined }}>
            {nodeTotalActuals > 0 ? nodeTotalActuals.toFixed(1) : ''}
          </Text>
        </Table.Td>
        {columns.map((col) => {
          const val = getRollupValue(col, 'ac');
          return (
            <Table.Td key={`${col.key}-ac`} className={`${classes.data_cell} ${classes.readonly_cell}`} style={{ borderTop: 'none', borderBottom: 'none', textAlign: 'right' }}>
              <Text size="sm" fw={500}>{val > 0 ? val.toFixed(1) : ''}</Text>
            </Table.Td>
          );
        })}
      </Table.Tr>

      {/* --- 3rd Row: Progress --- */}
      <Table.Tr>
        <Table.Td className={classes.metric_col} style={{ borderTop: 'none', borderBottom: progressBorderBottom }}>Prog.</Table.Td>
        <Table.Td className={classes.total_col} style={{ borderTop: 'none', borderBottom: progressBorderBottom }}>
            <Text size="sm" fw={500} c="teal.4">
                {isActivity 
                    ? (latestProgress !== null ? `${latestProgress}%` : '') 
                    : (getRollupProgress() !== null ? `${getRollupProgress()?.toFixed(1)}%` : '')
                }
            </Text>
        </Table.Td>
        {columns.map((col, idx) => {
            const dateStr = col.type === 'day' ? col.key : col.dates[col.dates.length - 1].format('YYYY-MM-DD');
            let displayProg: React.ReactNode = '';
            
            if (isActivity) {
                displayProg = col.type === 'day' ? (
                    <ProgressInputCell
                        wbsElementId={node.wbsElementId} date={dateStr}
                        initialValue={progressData[node.wbsElementId]?.[dateStr]?.value}
                        onCommit={onProgressChange}
                        isReadOnly={isReadOnly}
                    />
                ) : null;
            } else if (col.type === 'day') {
                const currentProg = getRollupProgress(dateStr);
                const prevDateStr = idx > 0 && columns[idx-1].type === 'day' ? (columns[idx-1] as DayColumn).key : dayjs(dateStr).subtract(1, 'day').format('YYYY-MM-DD');
                const prevProg = getRollupProgress(prevDateStr);
                if (currentProg !== null && currentProg !== prevProg) {
                    displayProg = <Text size="sm" fw={500} c="teal">{currentProg.toFixed(1)}%</Text>;
                }
            }

            return (
                <Table.Td key={`${col.key}-progress`} className={isActivity ? classes.data_cell : `${classes.data_cell} ${classes.readonly_cell}`} style={{ borderTop: 'none', padding: 0, textAlign: 'right', verticalAlign: 'middle', borderBottom: progressBorderBottom }}>
                    {displayProg}
                </Table.Td>
            );
        })}
      </Table.Tr>

      {/* User Rows */}
      {isActivity && usersToRender.map((userId, index) => {
        const user = userMap.get(userId);
        const isUnassigned = userId === 0;
        const isLastUser = index === usersToRender.length - 1;
        const totalAllocatedForUser = userTotalAllocated(userId);
        const totalActualsForUser = userTotalActuals(userId);

        const userEntries = data[node.wbsElementId]?.[userId];
        let pvStartIndex = -1, pvEndIndex = -1;
        let acStartIndex = -1, acEndIndex = -1;
        if (userEntries) {
          columns.forEach((col, dayIndex) => {
            const dates = col.type === 'day' ? [col.date] : col.dates;
            const pvHasValue = dates.some(d => (userEntries[d.format('YYYY-MM-DD')]?.pv || 0) > 0);
            const acHasValue = dates.some(d => (userEntries[d.format('YYYY-MM-DD')]?.ac?.value || 0) > 0);
            
            if (pvHasValue) {
              if (pvStartIndex === -1) pvStartIndex = dayIndex;
              pvEndIndex = dayIndex;
            }
            if (acHasValue) {
              if (acStartIndex === -1) acStartIndex = dayIndex;
              acEndIndex = dayIndex;
            }
          });
        }

        return (
          <React.Fragment key={userId}>
            {/* User PV Row */}
            <Table.Tr>
              <Table.Td rowSpan={2} className={classes.wbs_col} style={{ verticalAlign: 'middle', borderBottom: isLastUser ? itemBorderBottom : 'none' }}>
                <Group gap="xs" style={{ paddingLeft: (level * 20) + 30 }}>
                  <Avatar size="sm" color={isUnassigned ? 'gray' : 'blue'}>{isUnassigned ? '?' : user?.name.substring(0,2)}</Avatar>
                  <Text size="xs">{isUnassigned ? 'Unassigned' : user?.name}</Text>
                </Group>
              </Table.Td>
              <Table.Td className={`${classes.metric_col} ${classes.readonly_cell}`} style={{ borderBottom: 'none' }}>PV</Table.Td>
              <Table.Td className={classes.total_col} style={{ textAlign: 'right', verticalAlign: 'middle', borderBottom: 'none' }}>
                <Text size="sm" c="blue.3">{totalAllocatedForUser > 0 ? totalAllocatedForUser.toFixed(1) : ''}</Text>
              </Table.Td>
              {columns.map((col, dayIndex) => {
                const ganttClassesPv = [];
                if (dayIndex >= pvStartIndex && dayIndex <= pvEndIndex && pvStartIndex !== -1) {
                    ganttClassesPv.push(classes.ganttBarPv);
                    if (dayIndex === pvStartIndex) ganttClassesPv.push(classes.ganttEdgeStartPv);
                    if (dayIndex === pvEndIndex) ganttClassesPv.push(classes.ganttEdgeEndPv);
                }
                const dateStr = col.key;
                const cellId = `cell-pv-${node.wbsElementId}-${userId}-${dateStr}`;

                const value = col.type === 'day'
                    ? data[node.wbsElementId]?.[userId]?.[col.key]?.pv || 0
                    : col.dates.reduce((sum, d) => sum + (data[node.wbsElementId]?.[userId]?.[d.format('YYYY-MM-DD')]?.pv || 0), 0);
                return (
                  <Table.Td key={`${col.key}-pv`} className={`${classes.data_cell} ${ganttClassesPv.join(' ')}`} style={{ padding: 0, verticalAlign: 'middle', borderBottom: 'none' }}>
                    {col.type === 'day' ? (
                      <PvInputCell
                        wbsElementId={node.wbsElementId} userId={userId} date={dateStr}
                        initialPv={value || undefined}
                        onCommit={onPvChange}
                        isReadOnly={isReadOnly}
                        onKeyDown={onCellKeyDown} onPaste={onCellPaste}
                        onMouseDown={onCellMouseDown}
                        onMouseOver={onCellMouseOver}
                      />
                    ) : (
                      <div style={{ padding: '0 var(--mantine-spacing-xs)', minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', color: 'var(--mantine-color-blue-3)'}}>
                        {value > 0 ? value.toFixed(1) : ''}
                      </div>
                    )}
                  </Table.Td>
                )
              })}
            </Table.Tr>
            {/* User AC Row */}
            <Table.Tr>
              <Table.Td className={`${classes.metric_col} ${classes.readonly_cell}`} style={{ borderTop: 'none', borderBottom: isLastUser ? itemBorderBottom : normalBorderBottom }}>AC</Table.Td>
              <Table.Td className={classes.total_col} style={{ textAlign: 'right', verticalAlign: 'middle', borderTop: 'none', borderBottom: isLastUser ? itemBorderBottom : normalBorderBottom }}>
                <Text
                  size="sm"
                  fw={500}
                  style={{ color: totalActualsForUser > totalAllocatedForUser ? 'var(--mantine-color-red-7)' : undefined }}
                >
                  {totalActualsForUser > 0 ? totalActualsForUser.toFixed(1) : ''}
                </Text>
              </Table.Td>
              {columns.map((col, dayIndex) => {
                const dateStr = col.key;
                const cellId = `cell-ac-${node.wbsElementId}-${userId}-${dateStr}`;

                const ganttClassesAc = [];
                if (dayIndex >= acStartIndex && dayIndex <= acEndIndex && acStartIndex !== -1) {
                    ganttClassesAc.push(classes.ganttBarAc);
                    if (dayIndex === acStartIndex) ganttClassesAc.push(classes.ganttEdgeStartAc);
                    if (dayIndex === acEndIndex) ganttClassesAc.push(classes.ganttEdgeEndAc);
                }

                const value = col.type === 'day'
                    ? data[node.wbsElementId]?.[userId]?.[col.key]?.ac?.value || 0
                    : col.dates.reduce((sum, d) => sum + (data[node.wbsElementId]?.[userId]?.[d.format('YYYY-MM-DD')]?.ac?.value || 0), 0);

                return (
                  <Table.Td key={`${dateStr}-ac`} className={`${classes.data_cell} ${ganttClassesAc.join(' ')}`} style={{ padding: 0, borderTop: 'none', textAlign: 'right', verticalAlign: 'middle', borderBottom: isLastUser ? itemBorderBottom : normalBorderBottom }}>
                    {col.type === 'day' ? (
                      <AcInputCell
                        wbsElementId={node.wbsElementId} userId={userId} date={dateStr}
                        initialAc={value || undefined}
                        onCommit={onAcChange}
                        isReadOnly={isReadOnly || isUnassigned}
                        onKeyDown={onCellKeyDown} onPaste={onCellPaste}
                        onMouseDown={onCellMouseDown}
                        onMouseOver={onCellMouseOver}
                      />
                    ) : (
                      <div style={{padding: '0 var(--mantine-spacing-xs)', minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'flex-end'}}>
                        {value > 0 ? value.toFixed(1) : ''}
                      </div>
                    )}
                  </Table.Td>
                );
              })}
            </Table.Tr>
          </React.Fragment>
        )
      })}

    </>
  );
}, gridRowAreEqual);

// --- Main Component ---
export function ExecutionView({ planVersionId, isReadOnly }: GridProps) {
  const { users } = useUsers();
  const [importWizardOpened, { open: openImportWizard, close: closeImportWizard }] = useDisclosure(false);
  const [syncModalOpened, { open: openSyncModal, close: closeSyncModal }] = useDisclosure(false);
  const [syncDate, setSyncDate] = useState<Date | null>(new Date());
  const [isSyncing, setIsSyncing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (sessionStorage.getItem('execution_view_mode') as ViewMode) || 'daily';
  });
  const [zoomLevel, setZoomLevel] = useState(() => {
    const saved = sessionStorage.getItem('execution_zoom_level');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [currentMonth, setCurrentMonth] = useState(() => {
    const saved = sessionStorage.getItem('execution_current_month');
    return saved ? new Date(saved) : new Date();
  });

  useEffect(() => { sessionStorage.setItem('execution_view_mode', viewMode); }, [viewMode]);
  useEffect(() => { sessionStorage.setItem('execution_zoom_level', zoomLevel.toString()); }, [zoomLevel]);
  useEffect(() => { sessionStorage.setItem('execution_current_month', currentMonth.toISOString()); }, [currentMonth]);
  const [elements, setElements] = useState<WbsElementDetail[]>([]);
  const [executionData, setExecutionData] = useState<ExecutionMap>({});
  const [progressData, setProgressData] = useState<{ [wbsId: number]: { [date: string]: { id: number; value: number } } }>({});
  const [allPlanAllocations, setAllPlanAllocations] = useState<PvAllocation[]>([]);
  const [allPlanActuals, setAllPlanActuals] = useState<ActualCost[]>([]);
  const [assignedUsers, setAssignedUsers] = useState<{ [wbsId: number]: Set<number> }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedNodes, setCollapsedNodes] = useState(new Set<number>());
  const selectedCellsRef = useRef<Set<string>>(new Set());
  const isSelectingRef = useRef(false);
  const selectionAnchorRef = useRef<string | null>(null);

  const updateSelection = useEvent((newSelection: Set<string>) => {
      const current = selectedCellsRef.current;
      current.forEach(id => {
          if (!newSelection.has(id)) {
              const el = document.getElementById(id);
              if (el) el.style.backgroundColor = '';
          }
      });
      newSelection.forEach(id => {
          if (!current.has(id)) {
              const el = document.getElementById(id);
              if (el) el.style.backgroundColor = 'var(--mantine-color-blue-light)';
          }
      });
      selectedCellsRef.current = newSelection;
  });

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

  const columns = useMemo((): Column[] => {
    if (viewMode === 'daily') {
        return daysInMonth.map(d => ({
            key: d.format('YYYY-MM-DD'),
            type: 'day' as const,
            date: d,
        }));
    }
    
    // Weekly (ISO Monday-start)
    const weeksMap = new Map<string, dayjs.Dayjs[]>();
    daysInMonth.forEach(day => {
        const weekKey = `${day.isoWeekYear()}-W${day.isoWeek()}`;
        if (!weeksMap.has(weekKey)) {
            weeksMap.set(weekKey, []);
        }
        weeksMap.get(weekKey)!.push(day);
    });

    const weeklyColumns: WeekColumn[] = [];
    for (const [key, dates] of weeksMap.entries()) {
        const firstDay = dates[0];
        const lastDay = dates[dates.length - 1];
        weeklyColumns.push({
            key: key,
            type: 'week' as const,
            label: `W${firstDay.isoWeek()} (${firstDay.format('M/D')}-${lastDay.format('M/D')})`,
            dates: dates,
        });
    }
    return weeklyColumns;
  }, [daysInMonth, viewMode]);

  const fetchAllData = useCallback(async () => {
    if (!planVersionId) {
      setElements([]); setExecutionData({}); setAssignedUsers({}); setAllPlanActuals([]); setAllPlanAllocations([]); return;
    }
    setIsLoading(true); setError(null);
    const start = daysInMonth[0].format('YYYY-MM-DD');
    const end = daysInMonth[daysInMonth.length - 1].format('YYYY-MM-DD');

    try {
      const [wbs, data, allActuals, allAllocs] = await Promise.all([
        invoke<WbsElementDetail[]>('list_wbs_elements', { planVersionId }),
        invoke<ExecutionData>('get_execution_data', { payload: { planVersionId, startDate: start, endDate: end } }),
        invoke<ActualCost[]>('list_all_actuals_for_plan_version', { planVersionId }),
        invoke<PvAllocation[]>('list_all_allocations_for_plan_version', { planVersionId }),
      ]);
      setElements(wbs);
      setAllPlanActuals(allActuals);
      setAllPlanAllocations(allAllocs);

      const execMap: ExecutionMap = {};
      const initialAssigned: { [wbsId: number]: Set<number> } = {};

      const ensurePath = (wbsId: number, userId: number, date: string) => {
        if (!execMap[wbsId]) execMap[wbsId] = {};
        if (!execMap[wbsId][userId]) execMap[wbsId][userId] = {};
        if (!execMap[wbsId][userId][date]) execMap[wbsId][userId][date] = {};
      };
      
      const addAssignedUser = (wbsId: number, userId: number) => {
          if (!initialAssigned[wbsId]) initialAssigned[wbsId] = new Set();
          initialAssigned[wbsId].add(userId);
      };

      for (const pv of data.pvAllocations) {
          const userId = pv.userId ?? 0;
          ensurePath(pv.wbsElementId, userId, pv.startDate);
          execMap[pv.wbsElementId][userId][pv.startDate].pv = pv.plannedValue;
          if (pv.userId) addAssignedUser(pv.wbsElementId, pv.userId);
      }
      for (const ac of data.actualCosts) {
          ensurePath(ac.wbsElementId, ac.userId, ac.workDate);
          execMap[ac.wbsElementId][ac.userId][ac.workDate].ac = { id: ac.id, value: ac.actualCost };
          addAssignedUser(ac.wbsElementId, ac.userId);
      }
      const progMap: any = {};
      data.progressUpdates.forEach(p => {
        if(!progMap[p.wbsElementId]) progMap[p.wbsElementId] = {};
        progMap[p.wbsElementId][p.reportDate] = { id: p.id, value: p.progressPercent };
      });
      setProgressData(progMap);

      setExecutionData(execMap);
      setAssignedUsers(prev => {
        const newAssigned = { ...initialAssigned };
        for (const wbsId in prev) {
          if (newAssigned[wbsId]) {
            prev[wbsId].forEach(userId => newAssigned[wbsId].add(userId));
          } else {
            newAssigned[wbsId] = prev[wbsId];
          }
        }
        return newAssigned;
      });
    } catch (err: any) {
      console.error('Failed to fetch data:', err); setError(`Failed to load data. Check console.`);
    } finally {
      setIsLoading(false);
    }
  }, [planVersionId, daysInMonth]);

  useEffect(() => {
    const handleMouseUp = () => { isSelectingRef.current = false; };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  useEffect(() => { fetchAllData(); }, [fetchAllData]);

  const tree = useMemo(() => {
    const items = [...elements];
    const map: { [key: number]: TreeNode } = {};
    const roots: TreeNode[] = [];
    items.forEach((item) => { map[item.wbsElementId] = { ...item, children: [] }; });
    items.forEach((item) => {
      const node = map[item.wbsElementId];
      if (item.parentElementId && map[item.parentElementId]) { map[item.parentElementId].children.push(node); } else { roots.push(node); }
    });
    return roots;
  }, [elements]);

  const toggleCollapse = useCallback((nodeId: number) => {
    setCollapsedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setCollapsedNodes(new Set());
  }, []);

  const handleCollapseAll = useCallback(() => {
    const parentIds = elements
      .filter(e => e.elementType === 'Project' || e.elementType === 'WorkPackage')
      .map(e => e.wbsElementId);
    setCollapsedNodes(new Set(parentIds));
  }, [elements]);

  const flattenedTree = useMemo(() => {
    const flat: { node: TreeNode, level: number }[] = [];
    const traverse = (nodes: TreeNode[], level: number) => {
      for (const node of nodes) {
        flat.push({ node, level });
        if (node.children && !collapsedNodes.has(node.wbsElementId)) traverse(node.children, level + 1);
      }
    };
    traverse(tree, 0);
    return flat;
  }, [tree, collapsedNodes]);

  const { activityRowIds, columnKeys } = useMemo(() => {
    const rowIdTuples: { wbsId: number, userId: number }[] = [];
    const activities: WbsElementDetail[] = [];
    const traverse = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.elementType === 'Activity') {
          activities.push(node);
          const usersForActivity = new Set(assignedUsers[node.wbsElementId] || []);
          
          const unassignedData = executionData[node.wbsElementId]?.[0];
          if (unassignedData && Object.values(unassignedData).some(d => d.pv && d.pv > 0)) {
            usersForActivity.add(0);
          }

          Array.from(usersForActivity).sort((a,b) => a - b).forEach(userId => {
            rowIdTuples.push({ wbsId: node.wbsElementId, userId });
          });
        }
        if (node.children && !collapsedNodes.has(node.wbsElementId)) traverse(node.children);
      }
    };
    traverse(tree);
    return {
      activityRowIds: rowIdTuples,
      columnKeys: columns.map(c => c.key)
    };
  }, [tree, columns, assignedUsers, executionData, collapsedNodes]);

  const handlePvChange = useEvent(async (wbsElementId: number, userId: number, date: string, value: number | null) => {
    if (isReadOnly || !planVersionId) return;

    setExecutionData(prev => {
        const newData = JSON.parse(JSON.stringify(prev));
        const ensurePath = (wbsId: number, uId: number, d: string) => {
            if (!newData[wbsId]) newData[wbsId] = {};
            if (!newData[wbsId][uId]) newData[wbsId][uId] = {};
            if (!newData[wbsId][uId][d]) newData[wbsId][uId][d] = {};
        };
        ensurePath(wbsElementId, userId, date);

        if (value !== null && value > 0) {
            newData[wbsElementId][userId][date].pv = value;
        } else {
            if(newData[wbsElementId]?.[userId]?.[date]?.pv) {
                delete newData[wbsElementId][userId][date].pv;
            }
        }
        return newData;
    });

    try {
      await invoke('upsert_daily_allocation', { payload: { planVersionId, wbsElementId, userId: userId === 0 ? null : userId, date, plannedValue: value } });
      // This change might de-sync totals, so we refetch all allocations.
      const newAllocs = await invoke<PvAllocation[]>('list_all_allocations_for_plan_version', { planVersionId });
      setAllPlanAllocations(newAllocs);
    } catch (error) { 
        console.error('Failed to upsert daily allocation:', error); 
        fetchAllData(); // revert on error
    }
  });

  const handleAcChange = useEvent(async (wbsElementId: number, userId: number, date: string, value: number | null) => {
    if (isReadOnly) return;

    setExecutionData(prev => {
        const newData = JSON.parse(JSON.stringify(prev));
        const ensurePath = (wbsId: number, uId: number, d: string) => {
            if (!newData[wbsId]) newData[wbsId] = {};
            if (!newData[wbsId][uId]) newData[wbsId][uId] = {};
            if (!newData[wbsId][uId][d]) newData[wbsId][uId][d] = {};
        };
        ensurePath(wbsElementId, userId, date);

        if (value !== null && value > 0) {
            newData[wbsElementId][userId][date].ac = { id: prev[wbsElementId]?.[userId]?.[date]?.ac?.id || -1, value };
        } else {
            if(newData[wbsElementId]?.[userId]?.[date]?.ac) {
                delete newData[wbsElementId][userId][date].ac;
            }
        }
        return newData;
    });

    try {
      // NOTE: Unlike PV, AC user_id is NOT optional. We assume a valid user is assigned.
      await invoke('upsert_actual_cost', { payload: { wbsElementId, userId, workDate: date, actualCost: value } });
    } catch (error) { 
        console.error('Failed to upsert actual cost:', error); 
        fetchAllData(); // revert on error
    }
  });

  const handleProgressChange = useEvent(async (wbsElementId: number, date: string, value: number | null) => {
    if (isReadOnly) return;
    
    setProgressData(prev => {
        const newData = JSON.parse(JSON.stringify(prev));
        if (!newData[wbsElementId]) newData[wbsElementId] = {};
        if (value !== null && value >= 0) {
            newData[wbsElementId][date] = { id: prev[wbsElementId]?.[date]?.id || -1, value };
        } else {
            if (newData[wbsElementId]?.[date]) {
                delete newData[wbsElementId][date];
            }
        }
        return newData;
    });

    try {
        await invoke('upsert_progress_update', {
            payload: { wbsElementId, reportDate: date, progressPercent: value }
        });
    } catch (err) {
        console.error("Failed to upsert progress:", err);
        fetchAllData(); // revert on error
    }
  });
  
  const focusCell = (wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => document.getElementById(`cell-${metricType}-${wbsElementId}-${userId}-${date}`)?.focus();

  const handleAddUserToActivity = useEvent((wbsElementId: number, userId: number) => {
    setAssignedUsers(prev => {
      const newAssigned = { ...prev };
      const newSet = new Set(newAssigned[wbsElementId]); // Copy existing set or create new
      newSet.add(userId);
      newAssigned[wbsElementId] = newSet;
      return newAssigned;
    });
  });

  const handleCellMouseDown = useEvent((e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => {
    e.preventDefault();
    e.currentTarget.focus();
    isSelectingRef.current = true;
    const cellId = `cell-${metricType}-${wbsElementId}-${userId}-${date}`;
    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);

    if (e.shiftKey && selectionAnchorRef.current) {
        const startIdParts = selectionAnchorRef.current.split('-');
        const startWbsId = Number(startIdParts[2]);
        const startUserId = Number(startIdParts[3]);
        const startDate = startIdParts.slice(4).join('-');

        const startRow = findRowIndex(startWbsId, startUserId);
        const startCol = columnKeys.indexOf(startDate);
        const endRow = findRowIndex(wbsElementId, userId);
        const endCol = columnKeys.indexOf(date);

        if (startRow === -1 || startCol === -1 || endRow === -1 || endCol === -1) {
            updateSelection(new Set([cellId]));
            return;
        }
        
        const newSelectedCells = new Set<string>();
        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);
        const minCol = Math.min(startCol, endCol);
        const maxCol = Math.max(startCol, endCol);

        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const rowInfo = activityRowIds[r];
                const type = selectionAnchorRef.current?.split('-')[1] ?? metricType;
                newSelectedCells.add(`cell-${type}-${rowInfo.wbsId}-${rowInfo.userId}-${columnKeys[c]}`);
            }
        }
        updateSelection(newSelectedCells);
    } else {
        selectionAnchorRef.current = cellId;
        updateSelection(new Set([cellId]));
    }
  });

  const handleCellMouseOver = useEvent((wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => {
    if (!isSelectingRef.current || !selectionAnchorRef.current) return;
    
    const anchorType = selectionAnchorRef.current.split('-')[1];
    if (anchorType !== metricType) return;
    
    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
    const startIdParts = selectionAnchorRef.current.split('-');
    const startWbsId = Number(startIdParts[2]);
    const startUserId = Number(startIdParts[3]);
    const startDate = startIdParts.slice(4).join('-');

    const startRow = findRowIndex(startWbsId, startUserId);
    const startCol = columnKeys.indexOf(startDate);
    const endRow = findRowIndex(wbsElementId, userId);
    const endCol = columnKeys.indexOf(date);

    if (startRow === -1 || startCol === -1 || endRow === -1 || endCol === -1) return;

    const newSelectedCells = new Set<string>();
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);

    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            const rowInfo = activityRowIds[r];
            newSelectedCells.add(`cell-${metricType}-${rowInfo.wbsId}-${rowInfo.userId}-${columnKeys[c]}`);
        }
    }
    updateSelection(newSelectedCells);
  });

  const focusCellAndSelect = (wbsId: number, uId: number, d: string, type: 'pv' | 'ac') => {
      const targetId = `cell-${type}-${wbsId}-${uId}-${d}`;
      document.getElementById(targetId)?.focus();
      updateSelection(new Set([targetId]));
  };

  const handleCellKeyDown = useEvent((e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string, metricType: 'pv' | 'ac') => {
    const { key } = e;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'].includes(key) || viewMode === 'weekly') return;
    e.preventDefault();

    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
    const rowIndex = findRowIndex(wbsElementId, userId);
    const colIndex = columnKeys.indexOf(date);

    if (key === 'ArrowUp' && rowIndex > 0) {
      const { wbsId, userId: newUserId } = activityRowIds[rowIndex - 1];
      focusCellAndSelect(wbsId, newUserId, date, metricType);
    } else if (key === 'ArrowDown' && rowIndex < activityRowIds.length - 1) {
      const { wbsId, userId: newUserId } = activityRowIds[rowIndex + 1];
      focusCellAndSelect(wbsId, newUserId, date, metricType);
    } else if (key === 'ArrowLeft' && colIndex > 0) {
      focusCellAndSelect(wbsElementId, userId, columnKeys[colIndex - 1], metricType);
    } else if (key === 'ArrowRight' && colIndex < columnKeys.length - 1) {
      focusCellAndSelect(wbsElementId, userId, columnKeys[colIndex + 1], metricType);
    } else if (key === 'Delete' || key === 'Backspace') {
        const cellsToUpdate = selectedCellsRef.current.size > 1 ? selectedCellsRef.current : new Set([`cell-${metricType}-${wbsElementId}-${userId}-${date}`]);
        
        if (metricType === 'ac') {
            const costs = Array.from(cellsToUpdate).map(cellId => {
                const parts = cellId.split('-');
                return { wbsElementId: Number(parts[2]), userId: Number(parts[3]), workDate: parts.slice(4).join('-'), actualCost: null };
            });

            setExecutionData(prev => {
                const newData = JSON.parse(JSON.stringify(prev));
                costs.forEach(item => {
                    if (newData[item.wbsElementId]?.[item.userId]?.[item.workDate]?.ac) {
                        delete newData[item.wbsElementId][item.userId][item.workDate].ac;
                    }
                });
                return newData;
            });
            invoke('upsert_actual_costs_bulk', { payload: { costs } }).catch(err => { console.error("Bulk delete failed:", err); fetchAllData(); });
        } else { // 'pv'
            if (!planVersionId) return;
            const allocations = Array.from(cellsToUpdate).map(cellId => {
                const parts = cellId.split('-');
                const uId = Number(parts[3]);
                return { wbsElementId: Number(parts[2]), userId: uId === 0 ? null : uId, date: parts.slice(4).join('-'), plannedValue: null };
            });
            
            setExecutionData(prev => {
                const newData = JSON.parse(JSON.stringify(prev));
                allocations.forEach(item => {
                    const uId = item.userId ?? 0;
                    if (newData[item.wbsElementId]?.[uId]?.[item.date]?.pv) {
                        delete newData[item.wbsElementId][uId][item.date].pv;
                    }
                });
                return newData;
            });
            invoke('upsert_daily_allocations_bulk', { payload: { planVersionId, allocations } })
              .then(async () => {
                  const newAllocs = await invoke<PvAllocation[]>('list_all_allocations_for_plan_version', { planVersionId });
                  setAllPlanAllocations(newAllocs);
              })
              .catch(err => { console.error("Bulk PV delete failed:", err); fetchAllData(); });
        }
    }
  });

  const handleCellPaste = useEvent(async (e: React.ClipboardEvent<HTMLInputElement>, startWbsId: number, startUserId: number, startDate: string, metricType: 'pv' | 'ac') => {
    e.preventDefault();
    if (isReadOnly || viewMode === 'weekly' || !planVersionId) return;

    const pasteData = e.clipboardData.getData('text');
    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);

    if (metricType === 'ac') {
      let costs: { wbsElementId: number, userId: number, workDate: string, actualCost: number | null }[] = [];
      if (selectedCellsRef.current.size > 1 && !pasteData.includes('\t') && !pasteData.includes('\n') && !pasteData.includes('\r')) {
          const valueStr = pasteData.trim();
          const value = !isNaN(parseFloat(valueStr)) ? parseFloat(valueStr) : null;
          costs = Array.from(selectedCellsRef.current).map(cellId => {
              const parts = cellId.split('-');
              return { wbsElementId: Number(parts[2]), userId: Number(parts[3]), workDate: parts.slice(4).join('-'), actualCost: value };
          });
      } else {
          const rows = pasteData.split(/\r\n|\n|\r/);
          const startRIdx = findRowIndex(startWbsId, startUserId);
          const startCIdx = columnKeys.indexOf(startDate);
          if (startRIdx === -1 || startCIdx === -1) return;

          for (let i = 0; i < rows.length; i++) {
              const rowData = rows[i].split('\t');
              const rIdx = startRIdx + i;
              if (rIdx >= activityRowIds.length) break;
              const { wbsId, userId } = activityRowIds[rIdx];

              for (let j = 0; j < rowData.length; j++) {
                  const cIdx = startCIdx + j;
                  if (cIdx >= columnKeys.length) break;
                  const value = !isNaN(parseFloat(rowData[j])) ? parseFloat(rowData[j]) : null;
                  costs.push({ wbsElementId: wbsId, userId, workDate: columnKeys[cIdx], actualCost: value });
              }
          }
      }
      if (costs.length === 0) return;

      setExecutionData(prev => {
          const newData = JSON.parse(JSON.stringify(prev));
          costs.forEach(item => {
              const ensurePath = (wbsId: number, uId: number, d: string) => { if (!newData[wbsId]) newData[wbsId] = {}; if (!newData[wbsId][uId]) newData[wbsId][uId] = {}; if (!newData[wbsId][uId][d]) newData[wbsId][uId][d] = {}; };
              ensurePath(item.wbsElementId, item.userId, item.workDate);
              if(item.actualCost !== null && item.actualCost > 0) { newData[item.wbsElementId][item.userId][item.workDate].ac = { id: -1, value: item.actualCost }; } 
              else { if(newData[item.wbsElementId]?.[item.userId]?.[item.workDate]?.ac) { delete newData[item.wbsElementId][item.userId][item.workDate].ac; } }
          });
          return newData;
      });

      try { await invoke('upsert_actual_costs_bulk', { payload: { costs } }); fetchAllData(); } 
      catch (err) { console.error("Bulk AC paste failed:", err); fetchAllData(); }
    } else { // 'pv'
      let allocations: { wbsElementId: number, userId: number | null, date: string, plannedValue: number | null }[] = [];
      if (selectedCellsRef.current.size > 1 && !pasteData.includes('\t') && !pasteData.includes('\n') && !pasteData.includes('\r')) {
          const valueStr = pasteData.trim();
          const value = !isNaN(parseFloat(valueStr)) ? parseFloat(valueStr) : null;
          allocations = Array.from(selectedCellsRef.current).map(cellId => {
              const parts = cellId.split('-');
              const uId = Number(parts[3]);
              return { wbsElementId: Number(parts[2]), userId: uId === 0 ? null : uId, date: parts.slice(4).join('-'), plannedValue: value };
          });
      } else {
        const rows = pasteData.split(/\r\n|\n|\r/);
        const startRIdx = findRowIndex(startWbsId, startUserId);
        const startCIdx = columnKeys.indexOf(startDate);
        if (startRIdx === -1 || startCIdx === -1) return;

        for (let i = 0; i < rows.length; i++) {
          const rowData = rows[i].split('\t');
          const rIdx = startRIdx + i;
          if (rIdx >= activityRowIds.length) break;
          const { wbsId, userId } = activityRowIds[rIdx];

          for (let j = 0; j < rowData.length; j++) {
            const cIdx = startCIdx + j;
            if (cIdx >= columnKeys.length) break;
            const value = !isNaN(parseFloat(rowData[j])) ? parseFloat(rowData[j]) : null;
            allocations.push({ wbsElementId: wbsId, userId: userId === 0 ? null : userId, date: columnKeys[cIdx], plannedValue: value });
          }
        }
      }
      if (allocations.length === 0) return;

      setExecutionData(prev => {
        const newData = JSON.parse(JSON.stringify(prev));
        allocations.forEach(item => {
            const uId = item.userId ?? 0;
            const ensurePath = (wbsId: number, uId: number, d: string) => { if (!newData[wbsId]) newData[wbsId] = {}; if (!newData[wbsId][uId]) newData[wbsId][uId] = {}; if (!newData[wbsId][uId][d]) newData[wbsId][uId][d] = {}; };
            ensurePath(item.wbsElementId, uId, item.date);
            if (item.plannedValue !== null && item.plannedValue > 0) { newData[item.wbsElementId][uId][item.date].pv = item.plannedValue; }
            else { if (newData[item.wbsElementId]?.[uId]?.[item.date]?.pv) { delete newData[item.wbsElementId][uId][item.date].pv; }}
        });
        return newData;
      });

      try { 
        await invoke('upsert_daily_allocations_bulk', { payload: { planVersionId, allocations } });
        const newAllocs = await invoke<PvAllocation[]>('list_all_allocations_for_plan_version', { planVersionId });
        setAllPlanAllocations(newAllocs);
      } catch (err) { console.error("Bulk PV paste failed:", err); fetchAllData(); }
    }
  });

  const handleCopyTsv = async () => {
    const rows: string[][] = [];
    const maxLevels = 10;
    
    // 1. ヘッダー行の作成（自動マッピングに対応する完全一致のキーワード）
    const header = ['WBS ID'];
    for (let i = 1; i <= maxLevels; i++) header.push(`L${i}`);
    header.push('Type', 'Est. PV', 'Assignee', 'Description', 'Tags');
    
    // 表示中の日次カラム（YYYY-MM-DD）のみを抽出
    const dayColumns = columns.filter(c => c.type === 'day');
    dayColumns.forEach(col => {
      if (col.type === 'day') header.push(col.date.format('YYYY-MM-DD'));
    });
    rows.push(header);

    // WBSのパス（階層）を取得するヘルパー
    const getElementPath = (elementId: number) => {
      const path: string[] = [];
      let currentId: number | null | undefined = elementId;
      while (currentId != null) {
        const el = elements.find(e => e.wbsElementId === currentId);
        if (el) {
          path.unshift(el.title);
          currentId = el.parentElementId;
        } else {
          break;
        }
      }
      return path;
    };

    // 2. データ行の作成（Activityを対象とし、担当者ごとに展開）
    const activities = elements.filter(e => e.elementType === 'Activity');
    
    activities.forEach(activity => {
      const path = getElementPath(activity.wbsElementId);
      const pathCols = Array(maxLevels).fill('');
      path.forEach((p, i) => { if (i < maxLevels) pathCols[i] = p; });

      // このActivityにアサインされているユーザー（未アサイン=0も含む）
      const assignedUserIds = Array.from(assignedUsers[activity.wbsElementId] || []);
      if (assignedUserIds.length === 0) assignedUserIds.push(0);

      assignedUserIds.forEach(userId => {
        const user = users.find(u => u.id === userId);
        const userName = user ? user.name : (userId === 0 ? '' : `User ${userId}`);
        
        // TagsはJSON文字列で保存されているため展開する
        let tagsStr = '';
        try {
          tagsStr = activity.tags ? JSON.parse(activity.tags).join(', ') : '';
        } catch {
          tagsStr = activity.tags || '';
        }

        const row = [
          String(activity.wbsElementId),
          ...pathCols,
          activity.elementType,
          activity.estimatedPv ? String(activity.estimatedPv) : '',
          userName,
          activity.description || '',
          tagsStr
        ];

        // 日付ごとの実績(AC)を取得
        dayColumns.forEach(col => {
          if (col.type === 'day') {
            const dateStr = col.date.format('YYYY-MM-DD');
            const acValue = executionData[activity.wbsElementId]?.[userId]?.[dateStr]?.ac?.value;
            row.push(acValue ? String(acValue) : '');
          }
        });

        rows.push(row);
      });
    });

    const tsvContent = rows.map(r => r.join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(tsvContent);
      notifications.show({ title: 'Copied to Clipboard', message: 'Actual Costs (AC) data is ready to paste into Excel.', color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Error', message: 'Failed to copy to clipboard.', color: 'red' });
    }
  };

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (selectedCellsRef.current.size === 0 || !e.clipboardData || viewMode === 'weekly') return;
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.id.startsWith('cell-')) return;
      
      const metricType = activeEl.id.startsWith('cell-pv-') ? 'pv' : 'ac';
      if (!activeEl.id.startsWith(`cell-${metricType}-`)) return;

      e.preventDefault();

      const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
      let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;
      
      const cellCoords = Array.from(selectedCellsRef.current).map(cellId => {
        const parts = cellId.split('-'); // cell-ac-wbs-user-date
        const wbsId = Number(parts[2]);
        const userId = Number(parts[3]);
        const date = parts.slice(4).join('-');
        const r = findRowIndex(wbsId, userId);
        const c = columnKeys.indexOf(date);
        if (r > -1 && c > -1) {
            minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r);
            minCol = Math.min(minCol, c); maxCol = Math.max(maxCol, c);
        }
        return { r, c, wbsId, userId, date };
      }).filter(item => item.r > -1 && item.c > -1);

      if (minRow === Infinity) return;

      const grid: (number | string)[][] = Array(maxRow - minRow + 1).fill(0).map(() => Array(maxCol - minCol + 1).fill(''));
      
      cellCoords.forEach(({ r, c, wbsId, userId, date }) => {
        if (selectedCellsRef.current.has(`cell-${metricType}-${wbsId}-${userId}-${date}`)) {
          let value;
          if (metricType === 'ac') {
            value = executionData[wbsId]?.[userId]?.[date]?.ac?.value;
          } else {
            value = executionData[wbsId]?.[userId]?.[date]?.pv;
          }
          grid[r - minRow][c - minCol] = value ?? '';
        }
      });
      
      const tsv = grid.map(row => row.join('\t')).join('\n');
      e.clipboardData.setData('text/plain', tsv);
    };

    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [executionData, activityRowIds, columnKeys, viewMode]);

  const changeMonth = (amount: number) => setCurrentMonth(dayjs(currentMonth).add(amount, 'month').toDate());

  const handleSyncPvToAc = async () => {
    if (!planVersionId || !syncDate) return;
    setIsSyncing(true);
    try {
      await invoke('sync_pv_to_ac', {
        payload: { planVersionId, upToDate: dayjs(syncDate).format('YYYY-MM-DD') }
      });
      notifications.show({ title: 'Sync Successful', message: 'PVs have been updated to match ACs up to the selected date.', color: 'green' });
      closeSyncModal();
      fetchAllData();
    } catch (err: any) {
      console.error("Sync failed:", err);
      notifications.show({ title: 'Sync Failed', message: typeof err === 'string' ? err : 'An unknown error occurred.', color: 'red' });
    } finally {
      setIsSyncing(false);
    }
  };

  if (isReadOnly) return <Alert color="orange" title="Read-only Mode" icon={<IconAlertCircle />}>You are viewing a historical baseline. To record actuals or progress, please select the "Working Draft" from the header.</Alert>;
  if (!planVersionId) return <Text c="dimmed" ta="center" pt="xl">Please select a project to start tracking execution.</Text>;

  return (
    <Stack h="calc(100vh - 90px)">
      <Modal opened={syncModalOpened} onClose={closeSyncModal} title="Sync PV to AC (Re-baseline Support)">
        <Stack>
          <Alert color="blue" icon={<IconAlertCircle />}>
            This will permanently replace all PV (Planned Value) allocations up to the selected date with the actual recorded AC (Actual Cost) values. Use this to reset past deviations before saving a new baseline.
          </Alert>
          <DatePickerInput
            label="Sync up to date"
            description="All PVs on or before this date will be overwritten by ACs."
            value={syncDate}
            onChange={(val: any) => setSyncDate(val ? new Date(val) : null)}
            withAsterisk
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={closeSyncModal}>Cancel</Button>
            <Button color="red" onClick={handleSyncPvToAc} loading={isSyncing} disabled={!syncDate}>Sync PV to AC</Button>
          </Group>
        </Stack>
      </Modal>
      <ImportWizardModal
        opened={importWizardOpened}
        onClose={closeImportWizard}
        onSuccess={fetchAllData}
        planVersionId={planVersionId}
        isReadOnly={isReadOnly}
      />
      <Group justify="space-between">
        <Group>
            <Title order={2}>Execution Tracking (PV / AC)</Title>
            {!isReadOnly && (
              <>
                <Button size="xs" variant="default" onClick={handleCopyTsv} leftSection={<IconClipboardCopy size={14} />}>Copy TSV</Button>
                <Button size="xs" variant="default" onClick={openImportWizard}>Import</Button>
                <Button size="xs" variant="light" color="orange" onClick={openSyncModal} leftSection={<IconRefresh size={14} />}>Sync PV to AC</Button>
              </>
            )}
        </Group>
        <Group>
          <ActionIcon variant="default" onClick={() => setZoomLevel(prev => Math.max(0.5, prev - 0.1))}><IconZoomOut size={16} /></ActionIcon>
          <Text w={45} ta="center" size="sm" style={{ cursor: 'pointer' }} onClick={() => setZoomLevel(1.0)}>
            {Math.round(zoomLevel * 100)}%
          </Text>
          <ActionIcon variant="default" onClick={() => setZoomLevel(prev => Math.min(2.0, prev + 0.1))}><IconZoomIn size={16} /></ActionIcon>
          <SegmentedControl
              value={viewMode}
              onChange={(value) => setViewMode(value as ViewMode)}
              data={[
                { label: 'Daily', value: 'daily' },
                { label: 'Weekly', value: 'weekly' },
              ]}
            />
          <ActionIcon onClick={() => changeMonth(-1)} variant="default" aria-label="Previous month"><IconChevronLeft size={16} /></ActionIcon>
          <MonthPickerInput value={currentMonth} onChange={(date) => date && setCurrentMonth(new Date(date))} style={{ width: 150 }} />
          <ActionIcon onClick={() => changeMonth(1)} variant="default" aria-label="Next month"><IconChevronRight size={16} /></ActionIcon>
        </Group>
      </Group>

      {isLoading && <Center style={{ flex: 1 }}><Loader /></Center>}
      {error && <Alert title="Error" color="red" icon={<IconAlertCircle />}>{error}</Alert>}

      {!isLoading && !error && (
        <Box className={classes.table_container} style={{ overflow: 'auto', '--zoom': zoomLevel } as React.CSSProperties}>
          <Table className={classes.table} withColumnBorders verticalSpacing="0" horizontalSpacing="0">
            <Table.Thead>
              <Table.Tr>
                <Table.Th className={classes.wbs_col}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" fw={700}>WBS Element</Text>
                    <Group gap={4}>
                      <Tooltip label="Expand All">
                        <ActionIcon variant="subtle" size="sm" color="gray" onClick={handleExpandAll}>
                          <IconChevronsDown size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Collapse All">
                        <ActionIcon variant="subtle" size="sm" color="gray" onClick={handleCollapseAll}>
                          <IconChevronsRight size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                </Table.Th>
                <Table.Th className={classes.metric_col}>Metric</Table.Th>
                <Table.Th className={classes.total_col}>Total</Table.Th>
                {columns.map((col) => {
                  if (col.type === 'day') {
                    const isWeekend = col.date.day() === 0 || col.date.day() === 6;
                    return (
                      <Table.Th key={col.key} className={`${classes.day_header} ${isWeekend ? classes.day_header_weekend : ''}`}>
                        <div>{col.date.format('ddd')}</div>
                        <div>{col.date.format('D')}</div>
                      </Table.Th>
                    );
                  }
                  return (
                    <Table.Th key={col.key} className={classes.day_header}>
                      {col.label}
                    </Table.Th>
                  );
                })}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {flattenedTree.map(({ node, level }) => 
                <GridRow 
                    key={node.id} node={node} level={level} columns={columns} 
                    data={executionData} progressData={progressData} allElements={elements} allPlanAllocations={allPlanAllocations} allPlanActuals={allPlanActuals} users={users}
                    assignedUsersMap={assignedUsers}
                    onPvChange={handlePvChange} onAcChange={handleAcChange} onProgressChange={handleProgressChange} isReadOnly={isReadOnly} 
                    onAddUser={handleAddUserToActivity}
                    onCellKeyDown={handleCellKeyDown} 
                    onCellPaste={handleCellPaste} 
                    onCellMouseDown={handleCellMouseDown} 
                    onCellMouseOver={handleCellMouseOver}
                    isCollapsed={collapsedNodes.has(node.wbsElementId)}
                    onToggleCollapse={toggleCollapse}
                />
              )}
            </Table.Tbody>
            <ResourceCapacityFooter users={users} elements={elements} data={executionData} columns={columns} />
          </Table>
        </Box>
      )}
    </Stack>
  );
}
