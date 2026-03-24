import { useState } from 'react';
import {
  Table,
  Button,
  Group,
  Title,
  Modal,
  TextInput,
  Stack,
  ActionIcon,
  Tooltip,
  Text,
  Center,
  Loader,
  Container,
  NumberInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useForm, zodResolver } from '@mantine/form';
import { z } from 'zod';
import { IconPlus, IconPencil, IconTrash } from '@tabler/icons-react';
import { useUsers, UserPayload } from '../../hooks/useUsers';
import { User } from '../../types';
import { notifications } from '@mantine/notifications';

const userSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  role: z.string().min(1, 'Role is required'),
  email: z.string().email('Invalid email address').nullable().or(z.literal('')),
  dailyCapacity: z.preprocess(v => v === '' ? null : v, z.number().min(0, 'Capacity must be positive').nullable()),
});

export function UserManagementView() {
  const { users, loading, addUser, updateUser, deleteUser } = useUsers();
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [activeUser, setActiveUser] = useState<User | null>(null);

  const form = useForm<UserPayload>({
    initialValues: {
      name: '',
      role: '',
      email: '',
      dailyCapacity: 8,
    },
    validate: zodResolver(userSchema as any),
  });

  const handleOpenModal = (user: User | null) => {
    setActiveUser(user);
    form.reset();
    form.setValues(user ? { ...user, email: user.email || '', dailyCapacity: user.dailyCapacity ?? 8 } : { name: '', role: '', email: '', dailyCapacity: 8 });
    openModal();
  };

  const handleSubmit = async (values: UserPayload) => {
    const payload = { ...values, email: values.email || null, dailyCapacity: values.dailyCapacity ? Number(values.dailyCapacity) : null };
    if (activeUser) {
      await updateUser(activeUser.id, payload);
    } else {
      await addUser(payload);
    }
    closeModal();
  };

  const handleDelete = (user: User) => {
    // A confirmation modal would be a good addition in a real app
    notifications.show({
      id: `delete-confirm-${user.id}`,
      color: 'red',
      title: 'Delete User',
      message: `Are you sure you want to delete ${user.name}? This action cannot be undone.`,
      autoClose: false,
      withCloseButton: true,
      onClose: () => {},
      children: (
        <Group justify="flex-end" mt="md">
            <Button variant="outline" color="gray" size="xs" onClick={() => notifications.hide(`delete-confirm-${user.id}`)}>Cancel</Button>
            <Button color="red" size="xs" onClick={() => {
                deleteUser(user.id);
                notifications.hide(`delete-confirm-${user.id}`);
            }}>Delete</Button>
        </Group>
      )
    });
  };

  const rows = users.map((user) => (
    <Table.Tr key={user.id}>
      <Table.Td>{user.id}</Table.Td>
      <Table.Td>{user.name}</Table.Td>
      <Table.Td>{user.email}</Table.Td>
      <Table.Td>{user.role}</Table.Td>
      <Table.Td>{user.dailyCapacity}</Table.Td>
      <Table.Td>
        <Group gap="xs" justify='flex-end'>
          <Tooltip label="Edit user">
            <ActionIcon variant="subtle" onClick={() => handleOpenModal(user)}>
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Delete user">
            <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(user)}>
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Container>
      <Modal opened={modalOpened} onClose={closeModal} title={activeUser ? 'Edit User' : 'Add User'}>
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <TextInput withAsterisk label="Name" placeholder="John Doe" {...form.getInputProps('name')} />
            <TextInput withAsterisk label="Role" placeholder="Developer" {...form.getInputProps('role')} />
            <TextInput label="Email" placeholder="user@example.com" {...form.getInputProps('email')} />
            <NumberInput label="Daily Capacity (hours)" placeholder="8" min={0} {...form.getInputProps('dailyCapacity')} />
            <Group justify="flex-end" mt="md">
              <Button type="submit">{activeUser ? 'Update' : 'Create'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Group justify="space-between" mb="xl">
        <Title order={2}>User Management</Title>
        <Button onClick={() => handleOpenModal(null)} leftSection={<IconPlus size={14} />}>
          Add User
        </Button>
      </Group>

      {loading ? (
        <Center style={{ height: 200 }}><Loader /></Center>
      ) : users.length === 0 ? (
        <Text c="dimmed" ta="center">No users found. Add one to get started.</Text>
      ) : (
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{width: 50}}>ID</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Capacity</Table.Th>
              <Table.Th style={{width: 100, textAlign: 'right'}}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>{rows}</Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
