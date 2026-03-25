import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Group, Title, Text, Table, NumberInput, Badge, Box, Loader, Center, Alert, Stack, ActionIcon, Menu, Avatar, Tooltip, rem, SegmentedControl,
} from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { IconChevronLeft, IconChevronRight, IconAlertCircle, IconPlus } from '@tabler/icons-react';
import { WbsElementDetail, WbsElementType, PvAllocation, ActualCost, ExecutionData, User } from '../../types';
import { useUsers } from '../../hooks/useUsers';
import dayjs from 'dayjs';
import classes from './ExecutionView.module.css';
import weekOfYear from 'dayjs/plugin/weekOfYear';
dayjs.extend(weekOfYear);


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
const getBadgeColor = (type: WbsElementType) => ({ Project: 'blue', WorkPackage: 'cyan', Activity: 'teal' }[type] || 'gray');

// --- Sub-components ---
const AcInputCell = ({ wbsElementId, userId, date, initialAc, onCommit, isReadOnly, onKeyDown, onPaste, onMouseDown, onMouseOver, isSelected }: {
  wbsElementId: number; userId: number; date: string; initialAc?: number; isReadOnly: boolean;
  onCommit: (value: number | null) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
  onMouseDown: (e: React.MouseEvent<HTMLInputElement>) => void;
  onMouseOver: () => void;
  isSelected: boolean;
}) => {
  const [value, setValue] = useState<string | number>(initialAc ?? '');
  useEffect(() => { setValue(initialAc ?? ''); }, [initialAc]);

  const handleBlur = () => {
    const numericValue = value === '' ? null : Number(value);
    const initialNumericValue = initialAc ?? null;
    if (numericValue !== initialNumericValue) onCommit(numericValue);
  };

  return (
    <NumberInput
      id={`cell-ac-${wbsElementId}-${userId}-${date}`}
      classNames={{ input: classes.ac_input }}
      style={{
        backgroundColor: isSelected ? 'var(--mantine-color-blue-light)' : 'transparent',
        height: '100%',
      }}
      styles={{
        wrapper: { height: '100%' },
        input: { height: '100%', cursor: 'cell', textAlign: 'right', paddingRight: 'var(--mantine-spacing-xs)' }
      }}
      value={value}
      onChange={setValue}
      onBlur={handleBlur}
      onKeyDown={(e) => onKeyDown(e, wbsElementId, userId, date)}
      onPaste={(e) => onPaste(e, wbsElementId, userId, date)}
      onMouseDown={onMouseDown}
      onMouseOver={onMouseOver}
      step={0.1} min={0} hideControls
      readOnly={isReadOnly}
      variant="unstyled"
    />
  );
};

const ResourceCapacityFooter = ({ users, elements, data, columns }: {
    users: User[];
    elements: WbsElementDetail[];
    data: ExecutionMap;
    columns: Column[];
}) => {
    const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

    const dailyTotals = useMemo(() => {
        const totals: { [userId: number]: { [date: string]: number } } = {};
        const activityIds = new Set(elements.filter(e => e.elementType === 'Activity').map(e => e.wbsElementId));

        for (const wbsIdStr in data) {
            const wbsId = Number(wbsIdStr);
            if (!activityIds.has(wbsId)) continue;

            const userEntries = data[wbsId];
            for (const userIdStr in userEntries) {
                const userId = Number(userIdStr);
                if (userId === 0) continue; // Skip unassigned for capacity check

                if (!totals[userId]) totals[userId] = {};
                
                const dateEntries = userEntries[userId];
                for (const date in dateEntries) {
                    if (!totals[userId][date]) totals[userId][date] = 0;
                    totals[userId][date] += dateEntries[date].ac?.value || 0;
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
                <Table.Th className={classes.sticky_col_header} style={{ top: 'var(--table-header-height)' }}>Resource Capacity (Actuals)</Table.Th>
                <Table.Th colSpan={daysInMonth.length}></Table.Th>
                <Table.Th></Table.Th>
            </Table.Tr>
            {activeUserIds.map(userId => {
                const user = userMap.get(userId);
                const capacity = user?.dailyCapacity ?? 8.0; // Default capacity
                if (!user) return null;

                return (
                    <Table.Tr key={userId}>
                        <Table.Td className={`${classes.sticky_col} ${classes.sticky_col_1} ${classes.sticky_footer}`}>
                            <Group gap="xs">
                                <Avatar size="sm">{user.name.substring(0, 2)}</Avatar>
                                <Text size="xs">{user.name}</Text>
                            </Group>
                        </Table.Td>
                        <Table.Td className={`${classes.sticky_col} ${classes.sticky_col_2} ${classes.sticky_footer}`}></Table.Td>

                        {columns.map(col => {
                            const total = col.type === 'day'
                                ? dailyTotals[userId]?.[col.date.format('YYYY-MM-DD')] || 0
                                : col.dates.reduce((sum, day) => sum + (dailyTotals[userId]?.[day.format('YYYY-MM-DD')] || 0), 0);
                            
                            const capacity = user.dailyCapacity ?? 8.0;
                            const isOverloaded = col.type === 'day' 
                                ? total > capacity
                                : col.dates.some(d => (dailyTotals[userId]?.[d.format('YYYY-MM-DD')] || 0) > capacity);

                            return (
                                <Table.Td key={col.key} className={classes.sticky_footer} style={{textAlign: 'right', color: isOverloaded ? 'var(--mantine-color-red-7)' : undefined }}>
                                    {total > 0 ? total.toFixed(1) : ''}
                                </Table.Td>
                            );
                        })}
                    </Table.Tr>
                );
            })}
        </Table.Tfoot>
    );
};

const GridRow = ({ 
    node, level, columns, data, allElements, allPlanAllocations, allPlanActuals, users, assignedUsersMap,
    onAcChange, isReadOnly, onAddUser,
    onCellKeyDown, onCellPaste, onCellMouseDown, onCellMouseOver, selectedCells 
}: {
  node: TreeNode; level: number; columns: Column[]; data: ExecutionMap; allElements: WbsElementDetail[]; allPlanAllocations: PvAllocation[]; allPlanActuals: ActualCost[]; users: User[];
  assignedUsersMap: { [wbsId: number]: Set<number> };
  onAcChange: (wbsElementId: number, userId: number, date: string, value: number | null) => void;
  isReadOnly: boolean;
  onAddUser: (wbsElementId: number, userId: number) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
  onCellPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
  onCellMouseDown: (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
  onCellMouseOver: (wbsElementId: number, userId: number, date: string) => void;
  selectedCells: Set<string>;
}) => {
  const isActivity = node.elementType === 'Activity';
  const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);
  const assignedUsers = useMemo(() => assignedUsersMap[node.wbsElementId] || new Set(), [assignedUsersMap, node.wbsElementId]);

  const hasUnassignedPv = useMemo(() => {
    const unassignedData = data[node.wbsElementId]?.[0];
    if (!unassignedData) return false;
    return Object.values(unassignedData).some(d => d.pv && d.pv > 0);
  }, [data, node.wbsElementId]);

  const getRollupValue = (column: Column, type: 'pv' | 'ac'): number => {
    const getIds = (n: TreeNode): number[] => [n.wbsElementId, ...n.children.flatMap(getIds)];
    const descendantIds = getIds(node);
    const activityDescendants = allElements.filter(el => descendantIds.includes(el.wbsElementId) && el.elementType === 'Activity');
    
    return activityDescendants.reduce((sum, activity) => {
      const activityData = data[activity.wbsElementId];
      if (!activityData) return sum;
      return sum + Object.values(activityData).reduce((userSum, userEntries) => {
        const dates = column.type === 'day' ? [column.date] : column.dates;
        return userSum + dates.reduce((dateSum, date) => {
            const cellData = userEntries[date.format('YYYY-MM-DD')];
            if (!cellData) return dateSum;
            if (type === 'pv') return dateSum + (cellData.pv || 0);
            if (type === 'ac') return dateSum + (cellData.ac?.value || 0);
            return dateSum;
        }, 0);
      }, 0);
    }, 0);
  };

  const { nodeTotalAllocated, nodeTotalActuals } = useMemo(() => {
    const getDescendantActivityIds = (startNode: TreeNode): number[] => {
        let ids: number[] = [];
        const stack: TreeNode[] = [startNode];
        while (stack.length > 0) {
            const currentNode = stack.pop()!;
            if (currentNode.elementType === 'Activity') ids.push(currentNode.wbsElementId);
            currentNode.children.forEach(child => stack.push(child));
        }
        return ids;
    };
    const activityIds = getDescendantActivityIds(node);

    const totalAllocated = allPlanAllocations
        .filter(alloc => activityIds.includes(alloc.wbsElementId))
        .reduce((sum, alloc) => sum + alloc.plannedValue, 0);

    const totalActuals = allPlanActuals
        .filter(ac => activityIds.includes(ac.wbsElementId))
        .reduce((sum, ac) => sum + ac.actualCost, 0);
        
    return { nodeTotalAllocated: totalAllocated, nodeTotalActuals: totalActuals };
  }, [node, allPlanAllocations, allPlanActuals]);

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

  return (
    <>
      {/* PV Row (Plan) */}
      <Table.Tr>
        <Table.Td rowSpan={2} className={`${classes.sticky_col} ${classes.sticky_col_1}`} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
          <Group gap="xs" style={{ paddingLeft: level * 20 }}>
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
            <Text size="sm" truncate>{node.title}</Text>
          </Group>
        </Table.Td>
        <Table.Td className={`${classes.sticky_col} ${classes.sticky_col_2}`} style={{ textAlign: 'right', verticalAlign: 'middle', borderBottom: 'none' }}>
          <Text size="sm" c="dimmed">{nodeTotalAllocated > 0 ? nodeTotalAllocated.toFixed(1) : ''}</Text>
        </Table.Td>
        {columns.map((col) => {
          return (
            <Table.Td key={`${col.key}-pv`} className={classes.data_cell} style={{ textAlign: 'right', verticalAlign: 'middle', borderBottom: 'none' }}>
              <Text size="sm" c="dimmed">{getRollupValue(col, 'pv') > 0 ? getRollupValue(col, 'pv').toFixed(1) : ''}</Text>
            </Table.Td>
          );
        })}
      </Table.Tr>
      {/* AC Row (Actual) */}
      <Table.Tr>
        <Table.Td className={`${classes.sticky_col} ${classes.sticky_col_2}`} style={{ textAlign: 'right', verticalAlign: 'middle', borderTop: 'none' }}>
          <Text
            size="sm"
            fw={500}
            style={{ color: nodeTotalActuals > nodeTotalAllocated ? 'var(--mantine-color-red-7)' : undefined }}
          >
            {nodeTotalActuals > 0 ? nodeTotalActuals.toFixed(1) : ''}
          </Text>
        </Table.Td>
        {columns.map((col) => {
          return (
            <Table.Td key={`${col.key}-ac`} className={classes.data_cell} style={{ padding: 'var(--table-td-padding)', borderTop: 'none', textAlign: 'right', verticalAlign: 'middle' }}>
              <Text size="sm" fw={500}>{getRollupValue(col, 'ac') > 0 ? getRollupValue(col, 'ac').toFixed(1) : ''}</Text>
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
              <Table.Td rowSpan={2} className={`${classes.sticky_col} ${classes.sticky_col_1}`} style={{ verticalAlign: 'middle', borderBottom: isLastUser ? '1px solid var(--mantine-color-gray-3)' : 'none' }}>
                <Group gap="xs" style={{ paddingLeft: (level * 20) + 30 }}>
                  <Avatar size="sm" color={isUnassigned ? 'gray' : 'blue'}>{isUnassigned ? '?' : user?.name.substring(0,2)}</Avatar>
                  <Text size="xs">{isUnassigned ? 'Unassigned' : user?.name}</Text>
                </Group>
              </Table.Td>
              <Table.Td className={`${classes.sticky_col} ${classes.sticky_col_2}`} style={{ textAlign: 'right', verticalAlign: 'middle', borderBottom: 'none' }}>
                <Text size="sm" c="dimmed">{totalAllocatedForUser > 0 ? totalAllocatedForUser.toFixed(1) : ''}</Text>
              </Table.Td>
              {columns.map((col, dayIndex) => {
                const ganttClassesPv = [];
                if (dayIndex >= pvStartIndex && dayIndex <= pvEndIndex && pvStartIndex !== -1) {
                    ganttClassesPv.push(classes.ganttBarPv);
                    if (dayIndex === pvStartIndex) ganttClassesPv.push(classes.ganttEdgeStartPv);
                    if (dayIndex === pvEndIndex) ganttClassesPv.push(classes.ganttEdgeEndPv);
                }
                const value = col.type === 'day'
                    ? data[node.wbsElementId]?.[userId]?.[col.date.format('YYYY-MM-DD')]?.pv || 0
                    : col.dates.reduce((sum, d) => sum + (data[node.wbsElementId]?.[userId]?.[d.format('YYYY-MM-DD')]?.pv || 0), 0);
                return (
                  <Table.Td key={`${col.key}-pv`} className={`${classes.data_cell} ${ganttClassesPv.join(' ')}`} style={{ textAlign: 'right', verticalAlign: 'middle', borderBottom: 'none' }}>
                    <Text size="sm" c="dimmed">{value > 0 ? value.toFixed(1) : ''}</Text>
                  </Table.Td>
                )
              })}
            </Table.Tr>
            {/* User AC Row */}
            <Table.Tr>
              <Table.Td className={`${classes.sticky_col} ${classes.sticky_col_2}`} style={{ textAlign: 'right', verticalAlign: 'middle', borderTop: 'none', borderBottom: isLastUser ? '1px solid var(--mantine-color-gray-3)' : 'none' }}>
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
                    ? data[node.wbsElementId]?.[userId]?.[col.date.format('YYYY-MM-DD')]?.ac?.value || 0
                    : col.dates.reduce((sum, d) => sum + (data[node.wbsElementId]?.[userId]?.[d.format('YYYY-MM-DD')]?.ac?.value || 0), 0);

                return (
                  <Table.Td key={`${dateStr}-ac`} className={`${classes.data_cell} ${ganttClassesAc.join(' ')}`} style={{ padding: 0, borderTop: 'none', textAlign: 'right', verticalAlign: 'middle', borderBottom: isLastUser ? '1px solid var(--mantine-color-gray-3)' : 'none' }}>
                    {col.type === 'day' ? (
                      <AcInputCell
                        wbsElementId={node.wbsElementId} userId={userId} date={dateStr}
                        initialAc={value}
                        onCommit={(value) => onAcChange(node.wbsElementId, userId, dateStr, value)}
                        isReadOnly={isReadOnly || isUnassigned}
                        onKeyDown={onCellKeyDown} onPaste={onCellPaste}
                        onMouseDown={(e) => onCellMouseDown(e, node.wbsElementId, userId, dateStr)}
                        onMouseOver={() => onCellMouseOver(node.wbsElementId, userId, dateStr)}
                        isSelected={selectedCells.has(cellId)}
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

      {/* Child WBS Element Rows */}
      {node.children.map((child) => <GridRow key={child.id} node={child} level={level + 1} columns={columns} data={data} allElements={allElements} allPlanAllocations={allPlanAllocations} allPlanActuals={allPlanActuals} users={users} assignedUsersMap={assignedUsersMap} onAcChange={onAcChange} onAddUser={onAddUser} isReadOnly={isReadOnly} onCellKeyDown={onCellKeyDown} onCellPaste={onCellPaste} onCellMouseDown={onCellMouseDown} onCellMouseOver={onCellMouseOver} selectedCells={selectedCells} />)}
    </>
  );
};

// --- Main Component ---
export function ExecutionView({ planVersionId, isReadOnly }: GridProps) {
  const { users } = useUsers();
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [elements, setElements] = useState<WbsElementDetail[]>([]);
  const [executionData, setExecutionData] = useState<ExecutionMap>({});
  const [allPlanAllocations, setAllPlanAllocations] = useState<PvAllocation[]>([]);
  const [allPlanActuals, setAllPlanActuals] = useState<ActualCost[]>([]);
  const [assignedUsers, setAssignedUsers] = useState<{ [wbsId: number]: Set<number> }>({});
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

  const columns = useMemo((): Column[] => {
    if (viewMode === 'daily') {
        return daysInMonth.map(d => ({
            key: d.format('YYYY-MM-DD'),
            type: 'day' as const,
            date: d,
        }));
    }
    
    // Weekly
    const weeksMap = new Map<string, dayjs.Dayjs[]>();
    daysInMonth.forEach(day => {
        const weekKey = `${day.year()}-W${day.week()}`;
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
            label: `W${firstDay.week()} (${firstDay.format('M/D')}-${lastDay.format('M/D')})`,
            dates: dates,
        });
    }
    return weeklyColumns;
  }, [daysInMonth, viewMode]);

  const columns = useMemo((): Column[] => {
    if (viewMode === 'daily') {
        return daysInMonth.map(d => ({
            key: d.format('YYYY-MM-DD'),
            type: 'day' as const,
            date: d,
        }));
    }
    
    // Weekly
    const weeksMap = new Map<string, dayjs.Dayjs[]>();
    daysInMonth.forEach(day => {
        const weekKey = `${day.year()}-W${day.week()}`;
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
            label: `W${firstDay.week()} (${firstDay.format('M/D')}-${lastDay.format('M/D')})`,
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
    const handleMouseUp = () => setIsSelecting(false);
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

  const { activityRowIds, columnKeys } = useMemo(() => {
    const rowIdTuples: { wbsId: number, userId: number }[] = [];
    const activities: WbsElementDetail[] = [];
    const traverse = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.elementType === 'Activity') {
          activities.push(node);
          const usersForActivity = Array.from(assignedUsers[node.wbsElementId] || []);
          usersForActivity.sort((a,b) => a - b).forEach(userId => {
            rowIdTuples.push({ wbsId: node.wbsElementId, userId });
          });
        }
        if (node.children) traverse(node.children);
      }
    };
    traverse(tree);
    return {
      activityRowIds: rowIdTuples,
      columnKeys: columns.map(c => c.key)
    };
  }, [tree, columns, assignedUsers]);

  const handleAcChange = useCallback(async (wbsElementId: number, userId: number, date: string, value: number | null) => {
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
  }, [isReadOnly, fetchAllData]);
  
  const focusCell = (wbsElementId: number, userId: number, date: string) => document.getElementById(`cell-ac-${wbsElementId}-${userId}-${date}`)?.focus();

  const handleAddUserToActivity = (wbsElementId: number, userId: number) => {
    setAssignedUsers(prev => {
      const newAssigned = { ...prev };
      const newSet = new Set(newAssigned[wbsElementId]); // Copy existing set or create new
      newSet.add(userId);
      newAssigned[wbsElementId] = newSet;
      return newAssigned;
    });
  };

  const handleCellMouseDown = (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => {
    e.preventDefault();
    e.currentTarget.focus();
    setIsSelecting(true);
    const cellId = `cell-ac-${wbsElementId}-${userId}-${date}`;
    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);

    if (e.shiftKey && selectionAnchor) {
        const startIdParts = selectionAnchor.split('-');
        const startWbsId = Number(startIdParts[2]);
        const startUserId = Number(startIdParts[3]);
        const startDate = startIdParts.slice(4).join('-');

        const startRow = findRowIndex(startWbsId, startUserId);
        const startCol = dateStrs.indexOf(startDate);
        const endRow = findRowIndex(wbsElementId, userId);
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
                const rowInfo = activityRowIds[r];
                newSelectedCells.add(`cell-ac-${rowInfo.wbsId}-${rowInfo.userId}-${dateStrs[c]}`);
            }
        }
        setSelectedCells(newSelectedCells);
    } else {
        setSelectionAnchor(cellId);
        setSelectedCells(new Set([cellId]));
    }
  };

  const handleCellMouseOver = (wbsElementId: number, userId: number, date: string) => {
    if (!isSelecting || !selectionAnchor) return;
    
    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
    const startIdParts = selectionAnchor.split('-');
    const startWbsId = Number(startIdParts[2]);
    const startUserId = Number(startIdParts[3]);
    const startDate = startIdParts.slice(4).join('-');

    const startRow = findRowIndex(startWbsId, startUserId);
    const startCol = dateStrs.indexOf(startDate);
    const endRow = findRowIndex(wbsElementId, userId);
    const endCol = dateStrs.indexOf(date);

    if (startRow === -1 || startCol === -1 || endRow === -1 || endCol === -1) return;

    const newSelectedCells = new Set<string>();
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);

    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            const rowInfo = activityRowIds[r];
            newSelectedCells.add(`cell-ac-${rowInfo.wbsId}-${rowInfo.userId}-${dateStrs[c]}`);
        }
    }
    setSelectedCells(newSelectedCells);
  };

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => {
    const { key } = e;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'].includes(key) || viewMode === 'weekly') return;
    e.preventDefault();

    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
    const rowIndex = findRowIndex(wbsElementId, userId);
    const colIndex = columnKeys.indexOf(date);

    if (key === 'ArrowUp' && rowIndex > 0) {
      const { wbsId, userId } = activityRowIds[rowIndex - 1];
      focusCell(wbsId, userId, date);
    } else if (key === 'ArrowDown' && rowIndex < activityRowIds.length - 1) {
      const { wbsId, userId } = activityRowIds[rowIndex + 1];
      focusCell(wbsId, userId, date);
    } else if (key === 'ArrowLeft' && colIndex > 0) {
      focusCell(wbsElementId, userId, columnKeys[colIndex - 1]);
    } else if (key === 'ArrowRight' && colIndex < columnKeys.length - 1) {
      focusCell(wbsElementId, userId, columnKeys[colIndex + 1]);
    } else if (key === 'Delete' || key === 'Backspace') {
        const cellsToUpdate = selectedCells.size > 1 ? selectedCells : new Set([`cell-ac-${wbsElementId}-${userId}-${date}`]);
        const costs = Array.from(cellsToUpdate).map(cellId => {
            const parts = cellId.split('-');
            const wbsId = Number(parts[2]);
            const uId = Number(parts[3]);
            const d = parts.slice(4).join('-');
            return { wbsElementId: wbsId, userId: uId, workDate: d, actualCost: null };
        });

        // Optimistic UI update
        setExecutionData(prev => {
            const newData = JSON.parse(JSON.stringify(prev));
            costs.forEach(item => {
                if (newData[item.wbsElementId]?.[item.userId]?.[item.workDate]?.ac) {
                    delete newData[item.wbsElementId][item.userId][item.workDate].ac;
                }
            });
            return newData;
        });

        invoke('upsert_actual_costs_bulk', { payload: { costs } })
            .catch(err => { console.error("Bulk delete failed:", err); fetchAllData(); });
    }
  }, [activityRowIds, columnKeys, selectedCells, fetchAllData, viewMode]);

  const handleCellPaste = useCallback(async (e: React.ClipboardEvent<HTMLInputElement>, startWbsId: number, startUserId: number, startDate: string) => {
    e.preventDefault();
    if (isReadOnly || viewMode === 'weekly') return;

    const pasteData = e.clipboardData.getData('text');
    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
    let costs: { wbsElementId: number, userId: number, workDate: string, actualCost: number | null }[] = [];

    if (selectedCells.size > 1 && !pasteData.includes('\t') && !pasteData.includes('\n') && !pasteData.includes('\r')) {
        const valueStr = pasteData.trim();
        const value = !isNaN(parseFloat(valueStr)) ? parseFloat(valueStr) : null;
        costs = Array.from(selectedCells).map(cellId => {
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

    // Optimistic UI update
    setExecutionData(prev => {
        const newData = JSON.parse(JSON.stringify(prev));
        costs.forEach(item => {
            const ensurePath = (wbsId: number, uId: number, d: string) => {
                if (!newData[wbsId]) newData[wbsId] = {};
                if (!newData[wbsId][uId]) newData[wbsId][uId] = {};
                if (!newData[wbsId][uId][d]) newData[wbsId][uId][d] = {};
            };
            ensurePath(item.wbsElementId, item.userId, item.workDate);
            if(item.actualCost !== null && item.actualCost > 0) {
                newData[item.wbsElementId][item.userId][item.workDate].ac = { id: -1, value: item.actualCost };
            } else {
                if(newData[item.wbsElementId]?.[item.userId]?.[item.workDate]?.ac) {
                    delete newData[item.wbsElementId][item.userId][item.workDate].ac;
                }
            }
        });
        return newData;
    });

    try {
        await invoke('upsert_actual_costs_bulk', { payload: { costs } });
        fetchAllData(); // Re-sync with DB to get correct IDs
    } catch (err) {
        console.error("Bulk paste failed:", err);
        fetchAllData(); // Revert on error
    }
  }, [activityRowIds, columnKeys, isReadOnly, fetchAllData, selectedCells, viewMode]);

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (selectedCells.size === 0 || !e.clipboardData || viewMode === 'weekly') return;
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.id.startsWith('cell-ac-')) return;
      e.preventDefault();

      const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
      let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;
      
      const cellCoords = Array.from(selectedCells).map(cellId => {
        const parts = cellId.split('-');
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
        if (selectedCells.has(`cell-ac-${wbsId}-${userId}-${date}`)) {
          const value = executionData[wbsId]?.[userId]?.[date]?.ac?.value;
          grid[r - minRow][c - minCol] = value ?? '';
        }
      });
      
      const tsv = grid.map(row => row.join('\t')).join('\n');
      e.clipboardData.setData('text/plain', tsv);
    };

    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [selectedCells, executionData, activityRowIds, columnKeys, viewMode]);

  const changeMonth = (amount: number) => setCurrentMonth(dayjs(currentMonth).add(amount, 'month').toDate());

  if (isReadOnly) return <Alert color="orange" title="Read-only Mode" icon={<IconAlertCircle />}>You are viewing a historical baseline. To record actuals or progress, please select the "Working Draft" from the header.</Alert>;
  if (!planVersionId) return <Text c="dimmed" ta="center" pt="xl">Please select a project to start tracking execution.</Text>;

  return (
    <Stack h="100%">
      <Group justify="space-between">
        <Title order={2}>Execution Tracking (PV / AC)</Title>
        <Group>
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
        <Box className={classes.table_container}>
          <Table className={classes.table} withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className={`${classes.sticky_header} ${classes.sticky_col} ${classes.sticky_col_1}`} style={{zIndex: 3}}>WBS Element</Table.Th>
                <Table.Th className={`${classes.sticky_header} ${classes.sticky_col} ${classes.sticky_col_2}`} style={{width: '6rem', minWidth: '6rem', zIndex: 3}}>Total</Table.Th>
                {columns.map((col) => {
                  if (col.type === 'day') {
                    const isWeekend = col.date.day() === 0 || col.date.day() === 6;
                    return (
                      <Table.Th key={col.key} className={`${classes.sticky_header} ${classes.day_header} ${isWeekend ? classes.day_header_weekend : ''}`}
                        style={{width: '2.8rem', minWidth: '2.8rem', paddingLeft: 0, paddingRight: 0, textAlign: 'center'}}
                      >
                        <div>{col.date.format('ddd')}</div>
                        <div>{col.date.format('D')}</div>
                      </Table.Th>
                    );
                  }
                  return (
                    <Table.Th key={col.key} className={`${classes.sticky_header} ${classes.day_header}`} style={{minWidth: '7rem'}}>
                      {col.label}
                    </Table.Th>
                  );
                })}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tree.map(node => 
                <GridRow 
                    key={node.id} node={node} level={0} columns={columns} 
                    data={executionData} allElements={elements} allPlanAllocations={allPlanAllocations} allPlanActuals={allPlanActuals} users={users}
                    assignedUsersMap={assignedUsers}
                    onAcChange={handleAcChange} isReadOnly={isReadOnly} 
                    onAddUser={handleAddUserToActivity}
                    onCellKeyDown={handleCellKeyDown} 
                    onCellPaste={handleCellPaste} 
                    onCellMouseDown={handleCellMouseDown} 
                    onCellMouseOver={handleCellMouseOver} 
                    selectedCells={selectedCells} 
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
