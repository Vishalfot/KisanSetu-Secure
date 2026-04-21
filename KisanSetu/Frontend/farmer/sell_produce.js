// Frontend/farmer/sell_produce.js
import { supabase, uploadFile } from '../supabase-config.js';
import { initializeDashboard } from '../shared/auth-helper.js';
import { sendSystemNotification, initializeNotifications } from '../shared/notifications-manager.js';

let selectedFiles = [];
let editId = null; // Set if we're editing an existing listing

document.addEventListener('DOMContentLoaded', async function () {
    await initializeDashboard('Farmer');
    await initializeNotifications();

    // Check if we're in Edit mode (URL: sell_produce.html?edit=PRODUCE_ID)
    const params = new URLSearchParams(window.location.search);
    editId = params.get('edit');
    if (editId) {
        await loadExistingListing(editId);
    }

    // Image preview
    const fileInput = document.getElementById('cropImage');
    const uploadBox = document.querySelector('.file-upload-box');
    if (fileInput && uploadBox) {
        fileInput.addEventListener('change', function (e) {
            const files = Array.from(e.target.files);
            if (files.length > 0) {
                selectedFiles = files.slice(0, 3);
                const reader = new FileReader();
                reader.onload = (event) => {
                    uploadBox.innerHTML = `
                        <div style="position:relative;">
                            <img src="${event.target.result}" style="max-width:100%; max-height:120px; border-radius:12px; border:2px solid #2e7d32;">
                            <div style="font-size:0.8rem; color:#2e7d32; font-weight:600; margin-top:5px;">${selectedFiles.length} Photo(s) ready</div>
                        </div>`;
                    uploadBox.style.padding = '15px';
                };
                reader.readAsDataURL(files[0]);
            }
        });
    }

    // Form submission
    const form = document.getElementById('produce-form');
    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            // Validate harvest date
            const harvestDateInput = document.getElementById('harvestDate').value;
            const harvestDate = new Date(harvestDateInput);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (harvestDate < today) {
                alert('Harvest date cannot be in the past!');
                return;
            }

            // ── KEY FIX: Store quantity AS-IS in farmer's unit — NO conversion ──
            const quantity = parseFloat(document.getElementById('quantity').value);
            const unit = document.getElementById('unit').value;
            const totalBatches = parseInt(document.getElementById('total_batches').value) || 1;

            if (totalBatches < 1) {
                alert('Number of batches must be at least 1.');
                return;
            }

            // Batch size = total qty ÷ number of batches
            const batchSize = parseFloat((quantity / totalBatches).toFixed(2));

            const produceData = {
                crop_name: document.getElementById('cropName').value,
                variety: document.getElementById('variety').value,
                quantity: quantity,      // Stored in farmer's chosen unit (no conversion)
                unit: unit,
                price: parseFloat(document.getElementById('price').value),
                harvest_date: harvestDateInput,
                total_batches: totalBatches,
                batch_size: batchSize,
                status: 'Pending'
            };

            if (navigator.onLine) {
                await saveToDatabase(produceData);
            } else {
                saveToOfflineQueue(produceData);
            }
        });
    }
});

/* ── Live Batch Preview ────────────────────────────────────── */
window.updateBatchPreview = function () {
    const qty = parseFloat(document.getElementById('quantity')?.value);
    const batches = parseInt(document.getElementById('total_batches')?.value);
    const unit = document.getElementById('unit')?.value || '';
    const preview = document.getElementById('batch-preview');

    if (!preview) return;

    if (qty > 0 && batches > 0) {
        const each = (qty / batches).toFixed(2);
        document.getElementById('preview-total').textContent = `${qty} ${unit}`;
        document.getElementById('preview-batches').textContent = batches;
        document.getElementById('preview-each').textContent = `${each} ${unit}`;
        preview.classList.add('visible');
    } else {
        preview.classList.remove('visible');
    }
};

/* ── Edit Mode — Pre-fill form ─────────────────────────────── */
async function loadExistingListing(id) {
    try {
        const { data, error } = await supabase.from('produce').select('*').eq('id', id).single();
        if (error || !data) { alert('Listing not found.'); return; }

        document.getElementById('cropName').value = data.crop_name || '';
        document.getElementById('variety').value = data.variety || '';
        document.getElementById('quantity').value = data.quantity || '';
        document.getElementById('unit').value = data.unit || 'Quintal';
        document.getElementById('price').value = data.price || '';
        document.getElementById('harvestDate').value = data.harvest_date?.substring(0, 10) || '';
        document.getElementById('total_batches').value = data.total_batches || 1;

        window.updateBatchPreview();

        // Update UI for edit mode
        document.getElementById('page-heading').textContent = 'Edit Listing';

        // FIXED ID HERE:
        document.getElementById('voice-publish-btn').innerHTML = 'Update Listing <i class="fa-solid fa-check"></i>';
    } catch (err) {
        alert('Could not load listing: ' + err.message);
    }
}

/* ── Offline Queue ─────────────────────────────────────────── */
function saveToOfflineQueue(data) {
    const queue = JSON.parse(localStorage.getItem('kisanSetuOfflineQueue')) || [];
    queue.push(data);
    localStorage.setItem('kisanSetuOfflineQueue', JSON.stringify(queue));
    alert('Listing saved offline. It will publish automatically when internet is restored.');
    window.location.href = 'farmer_dashboard.html';
}

/* ── Save / Update in Supabase ─────────────────────────────── */
async function saveToDatabase(produceData) {
    // FIXED ID HERE:
    const submitBtn = document.getElementById('voice-publish-btn');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    submitBtn.disabled = true;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Please log in first.');

        // Upload images if any
        let imageUrls = [];
        if (selectedFiles.length > 0) {
            submitBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Uploading Photos...';
            for (const file of selectedFiles) {
                const fileName = `${user.id}/${Date.now()}-${file.name}`;
                const url = await uploadFile(file, 'produce-images', fileName);
                if (url) imageUrls.push(url);
            }
        }

        if (editId) {
            // ── UPDATE existing listing ──
            const { error } = await supabase
                .from('produce')
                .update({ ...produceData, ...(imageUrls.length > 0 ? { images: imageUrls } : {}) })
                .eq('id', editId);

            if (error) throw error;
            alert(`Listing updated successfully!`);
        } else {
            // ── INSERT new listing ──
            const { error } = await supabase
                .from('produce')
                .insert({ farmer_id: user.id, ...produceData, images: imageUrls });

            if (error) throw error;

            await sendSystemNotification(
                user.id,
                'Listing Published! 🌾',
                `Your ${produceData.quantity} ${produceData.unit} of ${produceData.crop_name} in ${produceData.total_batches} batches is now live.`,
                'success'
            );
            alert(`Success! Your ${produceData.crop_name} listing has been published.`);
        }

        window.location.href = 'my_listings.html';

    } catch (err) {
        console.error('Save error:', err);
        let errorMsg = err.message;
        if (errorMsg.includes('bucket not found') || errorMsg.includes('Bucket not found') || errorMsg.includes('does not exist')) {
            errorMsg = 'Image Upload requires a "produce-images" bucket in your Supabase storage. Please create it and set it to public.';
        }
        alert('Failed to save listing: ' + errorMsg);
        submitBtn.innerHTML = originalHtml;
        submitBtn.disabled = false;
    }
}