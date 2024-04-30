// utils.js
export function getStatusColor(status) {
    switch (status) {
      case 'Pending':
        return '#fbbf24'; // amber
      case 'Training':
        return '#10b981'; // emerald
      case 'Completed':
        return '#3b82f6'; // blue
      case 'Failed':
        return '#ef4444'; // red
      default:
        return '#6b7280'; // cool gray
    }
  }
  