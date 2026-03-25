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
  Menu,
  Avatar,
  Tooltip,
  rem,
  SegmentedControl,
  Button,
  Modal,
  Textarea,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { MonthPickerInput } from '@mantine/dates';
import { IconChevronLeft, IconChevronRight, IconAlertCircle, IconPlus } from '@tabler/icons-react';
import { WbsElementDetail, WbsElementType, PvAllocation, User } from '../../types';
import { useUsers } from '../../hooks/useUsers';
import dayjs from 'dayjs';
import classes from './AllocationGrid.module.css';
import weekOfYear from 'dayjs/plugin/weekOfYear';
dayjs.extend(weekOfYear);


// --- Types ---
interface ImportRow {
  level: number;
  title: string;
  estimatedPv: number | null;
}

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

interface AllocationMap {
  [wbsElementId: number]: {
    [userId: number]: { // 0 for unassigned
      [date: string]: { id: number; pv: number };
    };
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
  userId,
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
  userId: number;
  date: string;
  initialValue?: number;
  onCommit: (value: number | null) => void;
  isReadOnly: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
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
      id={`cell-pv-${wbsElementId}-${userId}-${date}`}
      classNames={{ input: classes.pv_input }}
      value={value}
      onChange={setValue}
      onBlur={handleBlur}
      onKeyDown={(e) => onKeyDown(e, wbsElementId, userId, date)}
      onPaste={(e) => onPaste(e, wbsElementId, userId, date)}
      onMouseDown={onMouseDown}
      onMouseOver={onMouseOver}
      style={{
        backgroundColor: isSelected ? 'var(--mantine-color-blue-light)' : 'transparent',
        height: '100%',
      }}
      styles={{
        wrapper: { height: '100%' },
        input: { height: '100%', cursor: 'cell', textAlign: 'right', paddingRight: 'var(--mantine-spacing-xs)' }
      }}
      step={0.1}
      min={0}
      hideControls
      readOnly={isReadOnly}
      variant="unstyled"
    />
  );
};

const WeeklyPvInputCell = ({
  wbsElementId,
  userId,
  dates,
  allocations,
  onBulkCommit,
  isReadOnly,
}: {
  wbsElementId: number;
  userId: number;
  dates: dayjs.Dayjs[];
  allocations: AllocationMap;
  onBulkCommit: (payload: any[]) => void;
  isReadOnly: boolean;
}) => {
  const initialValue = useMemo(() => {
    return dates.reduce((sum, day) => {
      const dateStr = day.format('YYYY-MM-DD');
      return sum + (allocations[wbsElementId]?.[userId]?.[dateStr]?.pv || 0);
    }, 0);
  }, [dates, allocations, wbsElementId, userId]);

  const [value, setValue] = useState<string | number>(initialValue > 0 ? initialValue.toFixed(1) : '');

  useEffect(() => {
    setValue(initialValue > 0 ? initialValue.toFixed(1) : '');
  }, [initialValue]);

  const handleBlur = () => {
    const numericValue = value === '' ? null : Number(value);
    const initialNumericValue = initialValue > 0 ? parseFloat(initialValue.toFixed(1)) : null;

    if (numericValue !== initialNumericValue && numericValue !== initialValue) {
      const weekdays = dates.filter(d => d.day() >= 1 && d.day() <= 5);
      const perDayValue = (numericValue && weekdays.length > 0) ? numericValue / weekdays.length : null;

      const payload = dates.map(day => ({
          wbsElementId,
          userId,
          date: day.format('YYYY-MM-DD'),
          plannedValue: (day.day() >= 1 && day.day() <= 5) ? perDayValue : null,
      }));
      onBulkCommit(payload);
    }
  };

  return (
    <NumberInput
      classNames={{ input: classes.pv_input }}
      value={value}
      onChange={setValue}
      onBlur={handleBlur}
      style={{ height: '100%' }}
      styles={{
        wrapper: { height: '100%' },
        input: { height: '100%', cursor: 'cell', textAlign: 'right', paddingRight: 'var(--mantine-spacing-xs)' }
      }}
      step={1}
      min={0}
      hideControls
      readOnly={isReadOnly}
      variant="unstyled"
    />
  );
};


const ResourceCapacityFooter = ({ users, elements, allocations, columns }: {
    users: User[];
    elements: WbsElementDetail[];
    allocations: AllocationMap;
    columns: Column[];
}) => {
    const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

    const dailyTotals = useMemo(() => {
        const totals: { [userId: number]: { [date: string]: number } } = {};
        const activityIds = new Set(elements.filter(e => e.elementType === 'Activity').map(e => e.wbsElementId));

        for (const wbsIdStr in allocations) {
            const wbsId = Number(wbsIdStr);
            if (!activityIds.has(wbsId)) continue;

            const userAllocs = allocations[wbsId];
            for (const userIdStr in userAllocs) {
                const userId = Number(userIdStr);
                if (userId === 0) continue; // Skip unassigned

                if (!totals[userId]) totals[userId] = {};
                
                const dateAllocs = userAllocs[userId];
                for (const date in dateAllocs) {
                    if (!totals[userId][date]) totals[userId][date] = 0;
                    totals[userId][date] += dateAllocs[date].pv;
                }
            }
        }
        return totals;
    }, [allocations, elements]);

    const activeUserIds = useMemo(() => Object.keys(dailyTotals).map(Number).sort((a,b) => a-b), [dailyTotals]);

    if (activeUserIds.length === 0) return null;
    
    return (
        <Table.Tfoot>
            <Table.Tr>
                <Table.Th colSpan={3}>Resource Capacity</Table.Th>
                <Table.Th colSpan={columns.length}></Table.Th>
            </Table.Tr>
            {activeUserIds.map(userId => {
                const user = userMap.get(userId);
                if (!user) return null;

                return (
                    <Table.Tr key={userId}>
                        <Table.Td>
                            <Group gap="xs">
                                <Avatar size="sm">{user.name.substring(0, 2)}</Avatar>
                                <Text size="xs">{user.name}</Text>
                            </Group>
                        </Table.Td>
                        <Table.Td></Table.Td>
                        <Table.Td></Table.Td>

                        {columns.map(col => {
                            const total = col.type === 'day'
                                ? dailyTotals[userId]?.[col.date.format('YYYY-MM-DD')] || 0
                                : col.dates.reduce((sum, day) => sum + (dailyTotals[userId]?.[day.format('YYYY-MM-DD')] || 0), 0);
                            
                            const capacity = user.dailyCapacity ?? 8.0;
                            const isOverloaded = col.type === 'day' 
                                ? total > capacity
                                : col.dates.some(d => (dailyTotals[userId]?.[d.format('YYYY-MM-DD')] || 0) > capacity);
                            
                            return (
                                <Table.Td key={col.key} style={{ color: isOverloaded ? 'var(--mantine-color-red-7)' : undefined, textAlign: 'right' }}>
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
  node, level, columns, allElements, users, assignedUsersMap, allocations, allPlanAllocations,
  onPvChange, onBulkPvChange, isReadOnly, onAddUser,
  onCellKeyDown, onCellPaste, onCellMouseDown, onCellMouseOver, selectedCells
}: {
  node: TreeNode; level: number; columns: Column[];
  allElements: WbsElementDetail[]; users: User[];
  assignedUsersMap: { [wbsId: number]: Set<number> };
  allocations: AllocationMap;
  allPlanAllocations: PvAllocation[];
  onPvChange: (wbsElementId: number, userId: number, date: string, value: number | null) => void;
  onBulkPvChange: (payload: any[]) => void;
  isReadOnly: boolean;
  onAddUser: (wbsElementId: number, userId: number) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, key: string) => void;
  onCellPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, key: string) => void;
  onCellMouseDown: (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, userId: number, key: string) => void;
  onCellMouseOver: (wbsElementId: number, userId: number, key: string) => void;
  selectedCells: Set<string>;
}) => {

  const isActivity = node.elementType === 'Activity';
  const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);
  const assignedUsers = useMemo(() => assignedUsersMap[node.wbsElementId] || new Set(), [assignedUsersMap, node.wbsElementId]);

  // --- Total Calculation Logic ---
  const { nodeTotalEstimated, nodeTotalAllocated } = useMemo(() => {
      const getDescendantActivityIds = (startNode: TreeNode): number[] => {
          let ids: number[] = [];
          const stack: TreeNode[] = [startNode];
          while (stack.length > 0) {
              const currentNode = stack.pop()!;
              if (currentNode.elementType === 'Activity') {
                  ids.push(currentNode.wbsElementId);
              }
              currentNode.children.forEach(child => stack.push(child));
          }
          return ids;
      };

      const activityIds = getDescendantActivityIds(node);
      
      const totalEstimated = activityIds.reduce((sum, id) => {
          const element = allElements.find(el => el.wbsElementId === id);
          return sum + (element?.estimatedPv || 0);
      }, 0);

      const totalAllocated = allPlanAllocations
          .filter(alloc => activityIds.includes(alloc.wbsElementId))
          .reduce((sum, alloc) => sum + alloc.plannedValue, 0);

      return { nodeTotalEstimated: totalEstimated, nodeTotalAllocated: totalAllocated };
  }, [node, allElements, allPlanAllocations]);

  const userTotalAllocated = (userId: number) => {
      return allPlanAllocations
          .filter(alloc => alloc.wbsElementId === node.wbsElementId && alloc.userId === userId)
          .reduce((sum, alloc) => sum + alloc.plannedValue, 0);
  };
  
  const hasUnassignedPv = useMemo(() => {
    const unassignedAllocs = allocations[node.wbsElementId]?.[0];
    if (!unassignedAllocs) return false;
    return Object.values(unassignedAllocs).some(alloc => alloc.pv > 0);
  }, [allocations, node.wbsElementId]);

  const getRollupValue = (column: Column): number => {
    const getIds = (n: TreeNode): number[] => [n.wbsElementId, ...n.children.flatMap(getIds)];
    const descendantIds = getIds(node);
    const activityDescendants = allElements.filter(el => descendantIds.includes(el.wbsElementId) && el.elementType === 'Activity');
    
    return activityDescendants.reduce((sum, activity) => {
      const activityAllocs = allocations[activity.wbsElementId];
      if (!activityAllocs) return sum;
      return sum + Object.values(activityAllocs).reduce((userSum, userAllocs) => {
        const dates = column.type === 'day' ? [column.date] : column.dates;
        return userSum + dates.reduce((dateSum, date) => dateSum + (userAllocs[date.format('YYYY-MM-DD')]?.pv || 0), 0);
      }, 0);
    }, 0);
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
      {/* Main WBS Element Row (Project, WorkPackage, or Activity summary) */}
      <Table.Tr>
        <Table.Td>
          <Group gap="xs" style={{ paddingLeft: level * 20 }}>
            {isActivity && (
              <Menu shadow="md" width={200}>
                <Menu.Target>
                  <Tooltip label="Add person">
                    <ActionIcon variant="subtle" size="sm"><IconPlus size={14} /></ActionIcon>
                  </Tooltip>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Assign a person</Menu.Label>
                  {availableUsers.map(user => (
                    <Menu.Item key={user.id} leftSection={<Avatar size="sm" color="blue">{user.name.substring(0, 2)}</Avatar>} onClick={() => onAddUser(node.wbsElementId, user.id)}>
                      {user.name}
                    </Menu.Item>
                  ))}
                  {availableUsers.length === 0 && <Menu.Item disabled>No other people to assign</Menu.Item>}
                </Menu.Dropdown>
              </Menu>
            )}
            <Badge color={getBadgeColor(node.elementType)} size="sm">{node.elementType.substring(0, 1)}</Badge>
            <Text size="sm" truncate>{node.title}</Text>
          </Group>
        </Table.Td>

        <Table.Td>{isActivity ? node.estimatedPv || '-' : (nodeTotalEstimated > 0 ? nodeTotalEstimated.toFixed(1) : '-')}</Table.Td>
        <Table.Td 
            style={{ color: nodeTotalAllocated > nodeTotalEstimated ? 'var(--mantine-color-red-7)' : undefined }}
        >
            {nodeTotalAllocated > 0 ? nodeTotalAllocated.toFixed(1) : '-'}
        </Table.Td>
        
        {columns.map((col) => (
          <Table.Td key={col.key} className={isActivity ? classes.activity_rollup_cell : classes.rollup_cell}>
            {getRollupValue(col) > 0 ? getRollupValue(col).toFixed(1) : '-'}
          </Table.Td>
        ))}
      </Table.Tr>
      
      {/* User rows for Activities */}
      {isActivity && usersToRender.map(userId => {
        const user = userMap.get(userId);
        const isUnassigned = userId === 0;

        const userAllocs = allocations[node.wbsElementId]?.[userId];
        let startIndex = -1, endIndex = -1;

        if (userAllocs) {
          columns.forEach((col, index) => {
            const dates = col.type === 'day' ? [col.date] : col.dates;
            const hasValue = dates.some(d => userAllocs[d.format('YYYY-MM-DD')]?.pv > 0);
            if (hasValue) {
              if (startIndex === -1) startIndex = index;
              endIndex = index;
            }
          });
        }
        
        return (
          <Table.Tr key={`${node.wbsElementId}-${userId}`}>
            <Table.Td>
              <Group gap="xs" style={{ paddingLeft: (level * 20) + 30 }}>
                <Avatar size="sm" color={isUnassigned ? 'gray' : 'cyan'}>{isUnassigned ? '?' : user?.name.substring(0,2)}</Avatar>
                <Text size="xs">{isUnassigned ? 'Unassigned' : (user?.name || `User ${userId}`)}</Text>
              </Group>
            </Table.Td>
            <Table.Td></Table.Td>
            <Table.Td>
                {userTotalAllocated(userId) > 0 ? userTotalAllocated(userId).toFixed(1) : '-'}
            </Table.Td>

            {columns.map((col, colIndex) => {
              const cellId = `cell-pv-${node.wbsElementId}-${userId}-${col.key}`;
              
              const ganttClasses = [];
              if (colIndex >= startIndex && colIndex <= endIndex && startIndex !== -1) {
                  ganttClasses.push(classes.ganttBar);
                  if (colIndex === startIndex) ganttClasses.push(classes.ganttEdgeStart);
                  if (colIndex === endIndex) ganttClasses.push(classes.ganttEdgeEnd);
              }

              return (
                <Table.Td key={col.key} style={{ padding: 0 }} className={ganttClasses.join(' ')}>
                  {col.type === 'day' ? (
                    <PvInputCell
                      wbsElementId={node.wbsElementId}
                      userId={userId}
                      date={col.key}
                      initialValue={allocations[node.wbsElementId]?.[userId]?.[col.key]?.pv}
                      onCommit={(value) => onPvChange(node.wbsElementId, userId, col.key, value)}
                      isReadOnly={isReadOnly}
                      onKeyDown={(e) => onCellKeyDown(e, node.wbsElementId, userId, col.key)}
                      onPaste={(e) => onCellPaste(e, node.wbsElementId, userId, col.key)}
                      onMouseDown={(e) => onCellMouseDown(e, node.wbsElementId, userId, col.key)}
                      onMouseOver={() => onCellMouseOver(node.wbsElementId, userId, col.key)}
                      isSelected={selectedCells.has(cellId)}
                    />
                  ) : (
                    <WeeklyPvInputCell
                      wbsElementId={node.wbsElementId}
                      userId={userId}
                      dates={col.dates}
                      allocations={allocations}
                      onBulkCommit={onBulkPvChange}
                      isReadOnly={isReadOnly}
                    />
                  )}
                </Table.Td>
              );
            })}
          </Table.Tr>
        )
      })}
      
      {/* Child WBS Element Rows */}
      {node.children.map((child) => (
        <GridRow
          key={child.id} node={child} level={level + 1} columns={columns}
          allElements={allElements} users={users}
          assignedUsersMap={assignedUsersMap}
          allocations={allocations}
          allPlanAllocations={allPlanAllocations}
          onPvChange={onPvChange} onBulkPvChange={onBulkPvChange} isReadOnly={isReadOnly} onAddUser={onAddUser}
          onCellKeyDown={onCellKeyDown} onCellPaste={onCellPaste}
          onCellMouseDown={onCellMouseDown} onCellMouseOver={onCellMouseOver}
          selectedCells={selectedCells}
        />
      ))}
    </>
  );
};

// --- Main Component ---
export function AllocationGrid({ planVersionId, isReadOnly }: GridProps) {
  const { users } = useUsers();
  const [importOpened, { open: openImportModal, close: closeImportModal }] = useDisclosure(false);
  const [importText, setImportText] = useState('');
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [elements, setElements] = useState<WbsElementDetail[]>([]);
  const [allocations, setAllocations] = useState<AllocationMap>({});
  const [allPlanAllocations, setAllPlanAllocations] = useState<PvAllocation[]>([]);
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
        // Use week() and year() to define a week uniquely. Using Monday as start of week.
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

  useEffect(() => {
    if (!importText.trim()) {
      setParsedRows([]);
      setParseError(null);
      return;
    }

    const lines = importText.trim().split(/\r\n|\n/);
    const newRows: ImportRow[] = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const parts = line.split(/\t|,/);
        if (parts.length < 2 || parts.length > 3) {
            setParseError(`Line ${i+1}: Expected 2 or 3 columns, but found ${parts.length}.`);
            setParsedRows([]);
            return;
        }

        const level = parseInt(parts[0], 10);
        if (isNaN(level) || level < 1 || level > 3) {
            setParseError(`Line ${i+1}: Level must be a number (1, 2, or 3), but found '${parts[0]}'.`);
            setParsedRows([]);
            return;
        }

        const title = parts[1].trim();
        if (!title) {
            setParseError(`Line ${i+1}: Title cannot be empty.`);
            setParsedRows([]);
            return;
        }
        
        let estimatedPv: number | null = null;
        if (parts.length === 3 && parts[2].trim()) {
            estimatedPv = parseFloat(parts[2]);
            if (isNaN(estimatedPv)) {
                setParseError(`Line ${i+1}: Estimated PV must be a number, but found '${parts[2]}'.`);
                setParsedRows([]);
                return;
            }
        }
        
        newRows.push({ level, title, estimatedPv });
    }

    setParsedRows(newRows);
    setParseError(null);
  }, [importText]);

  const handleImportWbs = async () => {
    if (!planVersionId || parsedRows.length === 0 || isReadOnly) return;

    try {
      const result = await invoke<number>('import_wbs_data', {
        payload: {
          planVersionId,
          rows: parsedRows,
        }
      });
      notifications.show({
        title: 'Import Successful',
        message: `Successfully imported ${result} WBS elements.`,
        color: 'green',
      });
      closeImportModal();
      setImportText('');
      fetchAllData();
    } catch (err: any) {
      console.error('Failed to import WBS:', err);
      notifications.show({
        title: 'Import Failed',
        message: typeof err === 'string' ? err : 'An unknown error occurred.',
        color: 'red',
      });
    }
  };

  useEffect(() => {
    const handleMouseUp = () => setIsSelecting(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const fetchAllData = useCallback(async () => {
    if (!planVersionId) {
      setElements([]);
      setAllocations({});
      setAllPlanAllocations([]);
      setAssignedUsers({});
      return;
    }
    setIsLoading(true);
    setError(null);
    const start = daysInMonth[0].format('YYYY-MM-DD');
    const end = daysInMonth[daysInMonth.length - 1].format('YYYY-MM-DD');

    try {
      const [wbs, monthAllocs, allAllocs] = await Promise.all([
        invoke<WbsElementDetail[]>('list_wbs_elements', { planVersionId }),
        invoke<PvAllocation[]>('list_allocations_for_period', {
          payload: { planVersionId, startDate: start, endDate: end },
        }),
        invoke<PvAllocation[]>('list_all_allocations_for_plan_version', { planVersionId }),
      ]);

      setElements(wbs);
      setAllPlanAllocations(allAllocs);

      const allocMap: AllocationMap = {};
      const initialAssigned: { [wbsId: number]: Set<number> } = {};

      for (const alloc of monthAllocs) {
        const userId = alloc.userId ?? 0;
        if (!allocMap[alloc.wbsElementId]) {
          allocMap[alloc.wbsElementId] = {};
        }
        if (!allocMap[alloc.wbsElementId][userId]) {
          allocMap[alloc.wbsElementId][userId] = {};
        }
        allocMap[alloc.wbsElementId][userId][alloc.startDate] = { id: alloc.id, pv: alloc.plannedValue };
        
        if (alloc.userId) {
            if (!initialAssigned[alloc.wbsElementId]) {
                initialAssigned[alloc.wbsElementId] = new Set();
            }
            initialAssigned[alloc.wbsElementId].add(alloc.userId);
        }
      }
      setAllocations(allocMap);
      // Keep existing assigned users if they're not in the new data, so manually added rows don't disappear on fetch
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
      console.error('Failed to fetch data:', err);
      setError(`Failed to load allocation data. Check console for details.`);
    } finally {
      setIsLoading(false);
    }
  }, [planVersionId, daysInMonth]);

  const handlePvChangeBulk = useCallback(async (payload: any[]) => {
    if (!planVersionId || isReadOnly) return;
    
    setAllocations(prev => {
        const newAllocs = JSON.parse(JSON.stringify(prev));
        payload.forEach(item => {
            const { wbsElementId, userId, date, plannedValue } = item;
            if (!newAllocs[wbsElementId]) newAllocs[wbsElementId] = {};
            if (!newAllocs[wbsElementId][userId]) newAllocs[wbsElementId][userId] = {};

            if (plannedValue !== null && plannedValue > 0) {
                newAllocs[wbsElementId][userId][date] = { id: prev[wbsElementId]?.[userId]?.[date]?.id || -1, pv: plannedValue };
            } else {
                if (newAllocs[wbsElementId]?.[userId]?.[date]) {
                    delete newAllocs[wbsElementId][userId][date];
                }
            }
        });
        return newAllocs;
    });

    try {
        await invoke('upsert_daily_allocations_bulk', { payload: { planVersionId, allocations: payload } });
        const allAllocs = await invoke<PvAllocation[]>('list_all_allocations_for_plan_version', { planVersionId });
        setAllPlanAllocations(allAllocs);
    } catch (err) {
        console.error("Bulk PV change failed:", err);
        fetchAllData(); // Revert on error
    }
  }, [planVersionId, isReadOnly, fetchAllData]);

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

  const { activityRowIds, columnKeys } = useMemo(() => {
    const rowIdTuples: { wbsId: number, userId: number }[] = [];
    const activities: WbsElementDetail[] = [];
    const traverse = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.elementType === 'Activity') {
          activities.push(node);
          const usersForActivity = new Set(assignedUsers[node.wbsElementId] || []);
          
          const unassignedAllocs = allocations[node.wbsElementId]?.[0];
          if (unassignedAllocs && Object.values(unassignedAllocs).some(a => a.pv > 0)) {
            usersForActivity.add(0);
          }

          Array.from(usersForActivity).sort((a,b) => a - b).forEach(userId => {
            rowIdTuples.push({ wbsId: node.wbsElementId, userId });
          });
        }
        if (node.children) traverse(node.children);
      }
    };
    traverse(tree);
    const keys = columns.map(c => c.key);
    return { activityRowIds: rowIdTuples, columnKeys: keys };
  }, [tree, columns, assignedUsers, allocations]);

  const focusCell = (wbsElementId: number, userId: number, key: string) => {
    const cell = document.getElementById(`cell-pv-${wbsElementId}-${userId}-${key}`);
    cell?.focus();
  };

  const handleCellMouseDown = (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, userId: number, key: string) => {
    e.preventDefault();
    if (viewMode === 'weekly') return; // Selection not supported in weekly view yet.
    e.currentTarget.focus();
    setIsSelecting(true);
    const cellId = `cell-pv-${wbsElementId}-${userId}-${key}`;
    
    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);

    if (e.shiftKey && selectionAnchor) {
        const startIdParts = selectionAnchor.split('-');
        const startWbsId = Number(startIdParts[2]);
        const startUserId = Number(startIdParts[3]);
        const startKey = startIdParts.slice(4).join('-');

        const startRow = findRowIndex(startWbsId, startUserId);
        const startCol = columnKeys.indexOf(startKey);
        const endRow = findRowIndex(wbsElementId, userId);
        const endCol = columnKeys.indexOf(key);

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
                const cellKey = columnKeys[c];
                newSelectedCells.add(`cell-pv-${rowInfo.wbsId}-${rowInfo.userId}-${cellKey}`);
            }
        }
        setSelectedCells(newSelectedCells);
    } else {
        setSelectionAnchor(cellId);
        setSelectedCells(new Set([cellId]));
    }
  };

  const handleCellMouseOver = (wbsElementId: number, userId: number, key: string) => {
    if (!isSelecting || !selectionAnchor || viewMode === 'weekly') return;
    
    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
    
    const startIdParts = selectionAnchor.split('-');
    const startWbsId = Number(startIdParts[2]);
    const startUserId = Number(startIdParts[3]);
    const startKey = startIdParts.slice(4).join('-');

    const startRow = findRowIndex(startWbsId, startUserId);
    const startCol = columnKeys.indexOf(startKey);
    const endRow = findRowIndex(wbsElementId, userId);
    const endCol = columnKeys.indexOf(key);

    if (startRow === -1 || startCol === -1 || endRow === -1 || endCol === -1) return;

    const newSelectedCells = new Set<string>();
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);

    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            const rowInfo = activityRowIds[r];
            const cellKey = columnKeys[c];
            newSelectedCells.add(`cell-pv-${rowInfo.wbsId}-${rowInfo.userId}-${cellKey}`);
        }
    }
    setSelectedCells(newSelectedCells);
  };

  const handlePvChange = useCallback(
    async (wbsElementId: number, userId: number, date: string, value: number | null) => {
      if (!planVersionId) return;

      setAllocations(prev => {
        const newAllocs = JSON.parse(JSON.stringify(prev));
        if (!newAllocs[wbsElementId]) newAllocs[wbsElementId] = {};
        if (!newAllocs[wbsElementId][userId]) newAllocs[wbsElementId][userId] = {};

        if (value !== null && value > 0) {
          newAllocs[wbsElementId][userId][date] = { id: prev[wbsElementId]?.[userId]?.[date]?.id || -1, pv: value };
        } else {
          delete newAllocs[wbsElementId][userId][date];
        }
        return newAllocs;
      });

      try {
        await invoke('upsert_daily_allocation', {
          payload: { planVersionId, wbsElementId, userId, date, plannedValue: value },
        });
      } catch (error) {
        console.error('Failed to upsert allocation:', error);
        fetchAllData();
      }
    },
    [planVersionId, fetchAllData]
  );

  const handleAddUserToActivity = (wbsElementId: number, userId: number) => {
    setAssignedUsers(prev => {
      const newAssigned = { ...prev };
      const newSet = new Set(newAssigned[wbsElementId]); // Copy existing set or create new
      newSet.add(userId);
      newAssigned[wbsElementId] = newSet;
      return newAssigned;
    });
  };

  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, key: string) => {
      const { key: eventKey } = e;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'].includes(eventKey) || viewMode === 'weekly') return;
      e.preventDefault();

      const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
      const rowIndex = findRowIndex(wbsElementId, userId);
      const colIndex = columnKeys.indexOf(key);

      if (eventKey === 'ArrowUp' && rowIndex > 0) {
        const { wbsId, userId } = activityRowIds[rowIndex - 1];
        focusCell(wbsId, userId, key);
      } else if (eventKey === 'ArrowDown' && rowIndex < activityRowIds.length - 1) {
        const { wbsId, userId } = activityRowIds[rowIndex + 1];
        focusCell(wbsId, userId, key);
      } else if (eventKey === 'ArrowLeft' && colIndex > 0) {
        focusCell(wbsElementId, userId, columnKeys[colIndex - 1]);
      } else if (eventKey === 'ArrowRight' && colIndex < columnKeys.length - 1) {
        focusCell(wbsElementId, userId, columnKeys[colIndex + 1]);
      } else if (eventKey === 'Delete' || eventKey === 'Backspace') {
        const cellsToUpdate = selectedCells.size > 1 ? selectedCells : new Set([`cell-pv-${wbsElementId}-${userId}-${key}`]);
        const payload = Array.from(cellsToUpdate).map(cellId => {
            const parts = cellId.split('-');
            const wbsId = Number(parts[2]);
            const uId = Number(parts[3]);
            const d = parts.slice(4).join('-');
            return { wbsElementId: wbsId, userId: uId, date: d, plannedValue: null };
        });

        if (planVersionId) {
            handlePvChangeBulk(payload);
        }
      }
    },
    [activityRowIds, columnKeys, planVersionId, selectedCells, handlePvChangeBulk, viewMode]
  );

  const handleCellPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLInputElement>, startWbsId: number, startUserId: number, startKey: string) => {
        e.preventDefault();
        if (isReadOnly || !planVersionId || viewMode === 'weekly') return;

        const pasteData = e.clipboardData.getData('text');
        let payload: { wbsElementId: number, userId: number, date: string, plannedValue: number | null }[] = [];
        const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);

        if (selectedCells.size > 1 && !pasteData.includes('\t') && !pasteData.includes('\n') && !pasteData.includes('\r')) {
            const valueStr = pasteData.trim();
            const value = !isNaN(parseFloat(valueStr)) ? parseFloat(valueStr) : null;
            payload = Array.from(selectedCells).map(cellId => {
                const parts = cellId.split('-');
                return { wbsElementId: Number(parts[2]), userId: Number(parts[3]), date: parts.slice(4).join('-'), plannedValue: value };
            });
        } else {
            const rows = pasteData.split(/\r\n|\n|\r/);
            const startRowIndex = findRowIndex(startWbsId, startUserId);
            const startColIndex = columnKeys.indexOf(startKey);
            if (startRowIndex === -1 || startColIndex === -1) return;

            for (let i = 0; i < rows.length; i++) {
                const rowData = rows[i].split('\t');
                const currentRowIndex = startRowIndex + i;
                if (currentRowIndex >= activityRowIds.length) break;
                const { wbsId, userId } = activityRowIds[currentRowIndex];

                for (let j = 0; j < rowData.length; j++) {
                    const currentColIndex = startColIndex + j;
                    if (currentColIndex >= columnKeys.length) break;
                    const valueStr = rowData[j].trim();
                    const value = !isNaN(parseFloat(valueStr)) ? parseFloat(valueStr) : null;
                    payload.push({ wbsElementId: wbsId, userId, date: columnKeys[currentColIndex], plannedValue: value });
                }
            }
        }
        
        if (payload.length > 0) {
            handlePvChangeBulk(payload);
        }
    },
    [activityRowIds, columnKeys, isReadOnly, planVersionId, selectedCells, handlePvChangeBulk, viewMode]
  );
  
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (selectedCells.size === 0 || !e.clipboardData || viewMode === 'weekly') return;
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.id.startsWith('cell-pv-')) return;
      e.preventDefault();

      const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
      let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;
      
      const cellCoords = Array.from(selectedCells).map(cellId => {
        const parts = cellId.split('-');
        const wbsId = Number(parts[2]);
        const userId = Number(parts[3]);
        const key = parts.slice(4).join('-');
        const r = findRowIndex(wbsId, userId);
        const c = columnKeys.indexOf(key);
        if (r > -1 && c > -1) {
            minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r);
            minCol = Math.min(minCol, c); maxCol = Math.max(maxCol, c);
        }
        return { r, c, wbsId, userId, key };
      }).filter(item => item.r > -1 && item.c > -1);

      if (minRow === Infinity) return;

      const grid: (number | string)[][] = Array(maxRow - minRow + 1).fill(0).map(() => Array(maxCol - minCol + 1).fill(''));
      
      cellCoords.forEach(({ r, c, wbsId, userId, key }) => {
        const cellId = `cell-pv-${wbsId}-${userId}-${key}`;
        if (selectedCells.has(cellId)) {
            const value = allocations[wbsId]?.[userId]?.[key]?.pv;
            grid[r - minRow][c - minCol] = value ?? '';
        }
      });
      
      const tsv = grid.map(row => row.join('\t')).join('\n');
      e.clipboardData.setData('text/plain', tsv);
    };

    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [selectedCells, allocations, activityRowIds, columnKeys, viewMode]);

  const changeMonth = (amount: number) => {
    setCurrentMonth(dayjs(currentMonth).add(amount, 'month').toDate());
  };

  if (!planVersionId) {
    return <Text c="dimmed" ta="center" pt="xl">Please select a project to see its allocation grid.</Text>;
  }

  return (
    <Stack h="100%">
      <Modal opened={importOpened} onClose={closeImportModal} title="Import WBS from Clipboard" size="xl">
        <Stack>
          <Text size="sm">
            Paste data from a spreadsheet (3 columns: Level, Title, Estimated PV).
            The data should be tab-separated or comma-separated.
          </Text>
          <Textarea
            value={importText}
            onChange={(e) => setImportText(e.currentTarget.value)}
            minRows={10}
            autosize
            placeholder={"1\tProject Alpha\n2\tWork Package 1\n3\tActivity 1.1\t80"}
          />
          {parseError && <Alert color="red" title="Parsing Error" icon={<IconAlertCircle />}>{parseError}</Alert>}
          {parsedRows.length > 0 && (
            <Box style={{ maxHeight: 300, overflowY: 'auto' }}>
              <Table withColumnBorders withRowBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Level</Table.Th>
                    <Table.Th>Title</Table.Th>
                    <Table.Th>Est. PV</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {parsedRows.map((row, index) => (
                    <Table.Tr key={index}>
                      <Table.Td>{row.level}</Table.Td>
                      <Table.Td style={{ paddingLeft: `${row.level * 1.5}rem` }}>{row.title}</Table.Td>
                      <Table.Td>{row.estimatedPv}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeImportModal}>Cancel</Button>
            <Button onClick={handleImportWbs} disabled={parsedRows.length === 0 || !!parseError || isReadOnly}>
              Import {parsedRows.length} rows
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Group justify="space-between">
        <Group>
          <Title order={2}>Resource Allocation</Title>
          {!isReadOnly && <Button size="xs" variant="default" onClick={openImportModal}>Import WBS</Button>}
        </Group>
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
                <Table.Th>WBS Element</Table.Th>
                <Table.Th>Est. PV</Table.Th>
                <Table.Th>Allocated</Table.Th>
                {columns.map((col) => {
                  if (col.type === 'day') {
                    const isWeekend = col.date.day() === 0 || col.date.day() === 6;
                    return (
                      <Table.Th key={col.key} className={`${classes.day_header} ${isWeekend ? classes.day_header_weekend : ''}`}
                        style={{width: '2.8rem', minWidth: '2.8rem', paddingLeft: 0, paddingRight: 0, textAlign: 'center'}}
                      >
                        <div>{col.date.format('ddd')}</div>
                        <div>{col.date.format('D')}</div>
                      </Table.Th>
                    );
                  }
                  return (
                    <Table.Th key={col.key} className={classes.day_header} style={{minWidth: '7rem'}}>
                      {col.label}
                    </Table.Th>
                  );
                })}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tree.map(node => (
                <GridRow
                    key={node.id} node={node} level={0} columns={columns}
                    allElements={elements} users={users}
                    assignedUsersMap={assignedUsers}
                    allocations={allocations}
                    allPlanAllocations={allPlanAllocations}
                    onPvChange={handlePvChange} onBulkPvChange={handlePvChangeBulk} isReadOnly={isReadOnly}
                    onAddUser={handleAddUserToActivity}
                    onCellKeyDown={handleCellKeyDown}
                    onCellPaste={handleCellPaste}
                    onCellMouseDown={handleCellMouseDown}
                    onCellMouseOver={handleCellMouseOver}
                    selectedCells={selectedCells}
                />
              ))}
            </Table.Tbody>
            <ResourceCapacityFooter users={users} elements={elements} allocations={allocations} columns={columns} />
          </Table>
        </Box>
      )}
    </Stack>
  );
}
