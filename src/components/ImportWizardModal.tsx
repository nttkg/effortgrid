import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Modal,
  Stack,
  Text,
  Textarea,
  Group,
  Button,
  Table,
  Select,
  ScrollArea,
  Box,
  Alert,
  Loader,
  LoadingOverlay,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
dayjs.extend(customParseFormat);

// --- Types ---

const MAPPING_TYPES = [
  { value: 'ignore', label: 'Ignore' },
  ...Array.from({ length: 10 }, (_, i) => ({
    value: `L${i + 1}`,
    label: `L${i + 1} (Hierarchy)`,
  })),
  { value: 'estimatedPv', label: 'Est. PV' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'dailyPv', label: 'Daily PV' },
  { value: 'dailyAc', label: 'Daily AC' },
];

const DATE_FORMATS = [
  'YYYY-MM-DD', 'YYYY/MM/DD', 'M/D/YYYY', 'M/D/YY',
  'MM/DD/YYYY', 'MM/DD/YY', 'DD-MMM-YY', 'DD-MMM-YYYY'
];

interface ColumnMap {
  type: string;
  date?: string; // YYYY-MM-DD format if type is dailyPv or dailyAc
}

interface MappedImportRow {
  hierarchy: string[];
  estimatedPv: number | null;
  assignee: string | null;
  dailyPvs: Record<string, number>;
  dailyAcs: Record<string, number>;
}

interface ImportWizardModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
  planVersionId: number | null;
  isReadOnly: boolean;
}

// --- Main Component ---

export function ImportWizardModal({
  opened,
  onClose,
  onSuccess,
  planVersionId,
  isReadOnly,
}: ImportWizardModalProps) {
  const [text, setText] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [columnMaps, setColumnMaps] = useState<ColumnMap[]>([]);
  const [previewRows, setPreviewRows] = useState<MappedImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // 1. Parse raw text into headers and data rows
  useEffect(() => {
    if (!text.trim()) {
      setHeaders([]);
      setDataRows([]);
      setColumnMaps([]);
      setError(null);
      return;
    }

    const lines = text.trim().split(/\r\n|\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return;

    const newHeaders = lines[0].split('\t');
    const newRows = lines.slice(1).map(line => line.split('\t'));

    setHeaders(newHeaders);
    setDataRows(newRows);
    setError(null);

    // 2. Auto-detect column types to create initial mapping
    const newMaps: ColumnMap[] = newHeaders.map(header => {
      const trimmedHeader = header.trim();
      const d = dayjs(trimmedHeader, DATE_FORMATS, true);
      if (d.isValid()) {
        return { type: 'dailyPv', date: d.format('YYYY-MM-DD') };
      }
      return { type: 'ignore' };
    });
    setColumnMaps(newMaps);
  }, [text]);

  // 3. Generate preview data with fill-down logic whenever mappings or data changes
  useEffect(() => {
    if (dataRows.length === 0 || columnMaps.length === 0) {
      setPreviewRows([]);
      return;
    }
    setError(null);

    try {
      const lastLevels = Array(10).fill('');
      const newPreviewRows = dataRows.map((row, rowIndex) => {
        // Fill down hierarchy
        for (let i = 0; i < 10; i++) {
          const colIndex = columnMaps.findIndex(m => m.type === `L${i + 1}`);
          if (colIndex !== -1) {
            const cellValue = row[colIndex]?.trim();
            if (cellValue) {
              lastLevels[i] = cellValue;
              // When a higher level changes, reset lower levels
              for (let j = i + 1; j < 10; j++) lastLevels[j] = '';
            }
          }
        }

        const hierarchy = lastLevels.filter(Boolean);
        if (hierarchy.length === 0 && row.some(cell => cell.trim() !== '')) {
            throw new Error(`Row ${rowIndex + 2}: No hierarchy defined. Make sure to map at least one 'L1' column and that the row isn't empty.`);
        }

        // Extract other values based on mapping
        const getVal = (type: string) => {
          const index = columnMaps.findIndex(m => m.type === type);
          return index !== -1 ? row[index]?.trim() || null : null;
        };
        const pvStr = getVal('estimatedPv');
        const estimatedPv = pvStr ? parseFloat(pvStr) : null;
        if (pvStr && isNaN(estimatedPv)) throw new Error(`Row ${rowIndex+2}: Invalid number for Est. PV`);
        
        const assignee = getVal('assignee');
        
        const dailyPvs: Record<string, number> = {};
        const dailyAcs: Record<string, number> = {};

        columnMaps.forEach((map, colIndex) => {
            const valStr = row[colIndex]?.trim();
            if (valStr) {
                const val = parseFloat(valStr);
                if (isNaN(val)) throw new Error(`Row ${rowIndex+2}, Col ${colIndex+1}: Invalid number for daily value`);

                if (map.type === 'dailyPv' && map.date) dailyPvs[map.date] = val;
                if (map.type === 'dailyAc' && map.date) dailyAcs[map.date] = val;
            }
        });

        return { hierarchy, estimatedPv, assignee, dailyPvs, dailyAcs };
      });
      setPreviewRows(newPreviewRows);
    } catch (e: any) {
        setError(e.message);
        setPreviewRows([]);
    }
  }, [dataRows, columnMaps]);
  
  const handleMapChange = (columnIndex: number, newType: string) => {
    const newMaps = [...columnMaps];
    const headerDate = dayjs(headers[columnIndex], DATE_FORMATS, true);
    newMaps[columnIndex] = { 
        type: newType, 
        date: (newType === 'dailyPv' || newType === 'dailyAc') && headerDate.isValid() ? headerDate.format('YYYY-MM-DD') : undefined
    };
    setColumnMaps(newMaps);
  };

  const handleImport = async () => {
    if (!planVersionId || isReadOnly || previewRows.length === 0 || error) return;
    setIsImporting(true);
    try {
        const result = await invoke('import_mapped_wbs', {
            payload: {
                planVersionId,
                rows: previewRows,
            }
        });
        notifications.show({
            title: 'Import Successful',
            message: `Successfully processed ${result} rows.`,
            color: 'green'
        });
        onSuccess();
        handleClose();
    } catch(err: any) {
        console.error("Import failed:", err);
        notifications.show({
            title: 'Import Failed',
            message: typeof err === 'string' ? err : 'An unknown error occurred.',
            color: 'red'
        });
    } finally {
        setIsImporting(false);
    }
  };
  
  const handleClose = () => {
      setText('');
      onClose();
  };

  return (
    <Modal opened={opened} onClose={handleClose} size="90%" title="Advanced WBS Import">
      <LoadingOverlay visible={isImporting} />
      <Stack>
        <Textarea
          label="Paste Tab-Separated Data"
          description="Paste data from your spreadsheet. The first row should be headers."
          minRows={5}
          autosize
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        {headers.length > 0 && (
          <>
            <Text fw={500}>2. Map Columns</Text>
            <Text size="sm" c="dimmed">
              Map each column from your data to a field. 'L1' is the highest level (e.g., Project).
              Date-like headers are automatically mapped to 'Daily PV'.
            </Text>
            <ScrollArea>
              <Box style={{ minWidth: headers.length * 150 }}>
                <Table withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      {headers.map((h, i) => <Table.Th key={i}>{h}</Table.Th>)}
                    </Table.Tr>
                    <Table.Tr>
                      {headers.map((_, i) => (
                        <Table.Th key={i}>
                          <Select
                            size="xs"
                            data={MAPPING_TYPES}
                            value={columnMaps[i]?.type || 'ignore'}
                            onChange={(val) => handleMapChange(i, val!)}
                          />
                        </Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                      {dataRows.slice(0, 5).map((row, i) => (
                          <Table.Tr key={i}>
                              {row.map((cell, j) => <Table.Td key={j}>{cell}</Table.Td>)}
                          </Table.Tr>
                      ))}
                  </Table.Tbody>
                </Table>
              </Box>
            </ScrollArea>
          </>
        )}
        {error && <Alert color="red" icon={<IconAlertCircle />} title="Validation Error">{error}</Alert>}
        {previewRows.length > 0 && !error && (
            <>
            <Text fw={500}>3. Preview (with Fill-Down Logic)</Text>
            <ScrollArea h={300}>
              <Table withColumnBorders withRowBorders>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>Hierarchy</Table.Th>
                        <Table.Th>Est. PV</Table.Th>
                        <Table.Th>Assignee</Table.Th>
                        <Table.Th>Daily Data Count</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {previewRows.map((row, i) => (
                        <Table.Tr key={i}>
                            <Table.Td>
                                {row.hierarchy.map((h, j) => (
                                    <Text key={j} style={{ marginLeft: j * 16 }}>{j > 0 && '↳ '}{h}</Text>
                                ))}
                            </Table.Td>
                            <Table.Td>{row.estimatedPv}</Table.Td>
                            <Table.Td>{row.assignee}</Table.Td>
                            <Table.Td>
                                {Object.keys(row.dailyPvs).length > 0 && `PV: ${Object.keys(row.dailyPvs).length}`}
                                {Object.keys(row.dailyAcs).length > 0 && ` AC: ${Object.keys(row.dailyAcs).length}`}
                            </Table.Td>
                        </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleImport} disabled={isReadOnly || previewRows.length === 0 || !!error || isImporting}>
            Import {previewRows.length} WBS Rows
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
