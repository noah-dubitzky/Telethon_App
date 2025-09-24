const multer = require('multer');
const fs = require('fs');
const path = require('path');

class UploadHandler {
    constructor() {
        this.setupDirectories(['uploads/images', 'uploads/videos']);
    }

    // Ensure required directories exist
    setupDirectories(directories) {
        directories.forEach((dir) => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    // Configure Multer storage
    configureStorage(destination) {
        return multer.diskStorage({
            destination: (req, file, cb) => {
                cb(null, destination);
            },
            filename: (req, file, cb) => {
                cb(null, `${Date.now()}-${file.originalname}`);
            },
        });
    }

    // Create Multer instance for images
    getImageUploader() {
        return multer({
            storage: this.configureStorage('uploads/images'),
            fileFilter: (req, file, cb) => {
                const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];
                if (allowedTypes.includes(file.mimetype)) {
                    cb(null, true);
                } else {
                    cb(new Error('Only image files are allowed! mimetype of: ' + file.mimetype), false);
                }
            },
        });
    }

    // Create Multer instance for videos
    getVideoUploader() {
        return multer({
            storage: this.configureStorage('uploads/videos'),
            fileFilter: (req, file, cb) => {
                const allowedTypes = ['video/mp4', 'video/mkv', 'video/avi', 'video/webm'];
                if (allowedTypes.includes(file.mimetype)) {
                    cb(null, true);
                } else {
                    cb(new Error('Only video files are allowed!'), false);
                }
            },
        });
    }
}

module.exports = UploadHandler;
